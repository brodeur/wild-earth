#!/usr/bin/env python3
"""Generate animal meshes with the Meshy API, for maintainers of the Wild Earth animal library.

Generation is a maintainer tool. It is never part of a tile build: a tile build resolves its species
list against library/animals/ and flags gaps; a maintainer fills a gap with this tool (or with a CC0
download or a contributor's model), reviews the result on the lineup page, and an adoption script
(like tools/build_deer.py) turns it into the client's tiers. See docs/animal-library.md.

The API key comes from the environment (MESHY_API_KEY) or from the repository's git-ignored .env file
(copy .env.example). The key is never printed, logged or written to any file.

  python3 tools/meshy_generate.py balance
  python3 tools/meshy_generate.py pricing
  python3 tools/meshy_generate.py generate --species corvus_corax --mode preview \\
      --prompt "common raven, ..." [--ai-model meshy-6-lite] [--dry-run] [--yes]
  python3 tools/meshy_generate.py generate --species corvus_corax --mode refine \\
      --preview-job library/animals/jobs/corvus_corax/<job_id> [--texture-prompt ...]
  python3 tools/meshy_generate.py generate --species corvus_corax --mode image --image ref.png
  python3 tools/meshy_generate.py status --job library/animals/jobs/corvus_corax/<job_id>
  python3 tools/meshy_generate.py rig --job library/animals/jobs/<species>/<job_id> [--dry-run]

Every job writes library/animals/jobs/<species>/<job_id>/job.json (mode, prompt, settings, task id,
timestamps, credits charged, balance before and after, the files downloaded with their sha256, and a
licence note) next to the downloaded GLB, textures and thumbnail. Meshy deletes API output three days
after it is generated (Terms of Use 2.5), so the tool downloads as soon as the task succeeds; if a run
is interrupted, `status --job <dir>` resumes polling and downloads.

Standard library only (Python 3.9+). Nothing downloaded is executed.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://api.meshy.ai'
JOBS = os.path.join(ROOT, 'library', 'animals', 'jobs')
LIBRARY = os.path.join(ROOT, 'library', 'animals')
UA = 'wild-earth-meshy-generate/1'

# ---- pricing, read from the Meshy docs (credits per request) ----
PRICING_URL = 'https://docs.meshy.ai/en/api/pricing'
PRICING_READ = '2026-10-24'
# preview / image-to-3D, mesh only, by ai_model
MESH_COST = {'latest': 20, 'meshy-7.1': 20, 'meshy-7': 20, 'meshy-6': 20, 'meshy-6-lite': 5, 'meshy-t2': 5, 'meshy-t2.5': 5}
# image-to-3D with textures, by ai_model and texture resolution
IMAGE_TEX_COST = {
    'latest': {'2k': 30, '4k': 30, '8k': 35}, 'meshy-7.1': {'2k': 30, '4k': 30, '8k': 35}, 'meshy-7': {'2k': 30, '4k': 30, '8k': 35},
    'meshy-6': {'2k': 30, '4k': 30, '8k': 35}, 'meshy-6-lite': {'2k': 15},
    'meshy-t2': {'2k': 15, '4k': 15, '8k': 20}, 'meshy-t2.5': {'2k': 15, '4k': 15, '8k': 20},
}
REFINE_COST = {'2k': 10, '4k': 10, '8k': 15}
RIG_COST = 5
PRICING_TEXT = f"""Meshy API pricing (credits per request), read {PRICING_READ} from {PRICING_URL}

  Text to 3D preview (mesh only)    latest / meshy-7.1 / meshy-6: 20    meshy-6-lite / meshy-t2 / meshy-t2.5: 5
  Text to 3D refine (texturing)     2K or 4K textures: 10               8K: 15   (billed on top of the preview)
  Image to 3D, mesh only            latest / meshy-7.1 / meshy-6: 20    meshy-6-lite / meshy-t2 / meshy-t2.5: 5
  Image to 3D, 2K textures          latest / meshy-7.1 / meshy-6: 30    meshy-6-lite / meshy-t2 / meshy-t2.5: 15
  Image to 3D, 4K textures          latest / meshy-7.1 / meshy-6: 30    meshy-t2 / meshy-t2.5: 15   (not meshy-6-lite)
  Image to 3D, 8K textures          latest / meshy-7.1 / meshy-6: 35    meshy-t2 / meshy-t2.5: 20   (not meshy-6-lite)
  Multi-image to 3D                 as image to 3D (not meshy-t2 / t2.5)
  Ultra geometry (2k / 4k)          +5, latest / meshy-7.1 only
  Auto-rigging                      5 per request (humanoid, textured models only)
  Animation                         3 per action (up to 10 actions per request)
  Remesh / UV unwrap                5        Convert / resize: 1
  Text to image                     3-9 by image model

  A textured text-to-3D model is a preview plus a refine: 15 (meshy-6-lite) to 30 (latest) at 2K.
  Failed tasks are refunded (consumed_credits 0). Deleting a PENDING task refunds it; nothing else does.
  The API needs a paid plan (402 otherwise). Balance, task status and downloads are free.
"""

LICENCE_NOTE = (
    'Generated through the Meshy API, which requires a paid plan (402 on a free plan). Meshy Terms of Use '
    '(https://www.meshy.ai/terms-of-use, last updated 2026-09-19), section 3.2: customers on a paid plan own '
    'their Customer Output to the extent permitted by law (free-plan output is owned by Meshy and offered '
    'under CC BY 4.0 with credit to Meshy). As owner, the account holder may license this model under the '
    'project\'s CC BY-SA 4.0 asset licence, to the extent copyright subsists in AI-generated output. '
    'Section 2.4: do not remove or alter AI-identifying metadata or watermarks Meshy embeds; carry them '
    'into adopted tiers. Section 2.5: API output is deleted by Meshy 3 days after generation, so keep '
    'this folder until the model is adopted. Credit: "generated with Meshy (meshy.ai)".')


# ---- key handling: never print, log or persist it ----
class KeyMissing(Exception):
    pass


def api_key():
    k = os.environ.get('MESHY_API_KEY', '').strip()
    if k:
        return k
    path = os.path.join(ROOT, '.env')
    if os.path.isfile(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                name, val = line.split('=', 1)
                name = name.strip()
                if name.startswith('export '):
                    name = name[7:].strip()
                if name == 'MESHY_API_KEY':
                    val = val.strip().strip('"').strip("'")
                    if val:
                        return val
    raise KeyMissing(
        'MESHY_API_KEY is not set. Put it in the environment, or copy .env.example to .env in the repository '
        'root and fill it in (the file is git-ignored; keep it owner-only: chmod 600 .env). '
        'Keys are created at https://www.meshy.ai/settings/api (paid plan required).')


class ApiError(Exception):
    def __init__(self, status, message, retry_after=None):
        super().__init__(f'HTTP {status}: {message}')
        self.status, self.message, self.retry_after = status, message, retry_after


HINTS = {
    400: 'the request was rejected (bad parameter, prompt over 800 characters, or an unsupported model combination)',
    401: 'the API key is missing or invalid',
    402: 'not enough credits, or the account is on the free plan (the API needs a paid plan)',
    403: 'the input cannot be used for this task',
    404: 'no such task (Meshy deletes API output 3 days after generation)',
    409: 'the task is in progress and cannot be deleted',
    422: 'the model could not be processed (for rigging: pose estimation failed; the model may not be humanoid)',
    429: 'rate limited',
}

_last_request = [0.0]


def request(method, path, body=None, key=None, max_retries=6):
    """One API call. Paces requests (well under the 20 per second plan limit), honours Retry-After on
    429 for per-second limits, and does not retry concurrent-task limits on a timer."""
    url = API + path
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(max_retries + 1):
        wait = 0.25 - (time.time() - _last_request[0])
        if wait > 0:
            time.sleep(wait)
        _last_request[0] = time.time()
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('Authorization', 'Bearer ' + (key or api_key()))
        req.add_header('User-Agent', UA)
        if data is not None:
            req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read() or b'{}')
                msg = payload.get('message') or json.dumps(payload)
            except Exception:
                msg = e.reason
            ra = e.headers.get('Retry-After') if e.headers else None
            if e.code == 429 and str(msg).startswith(('NoMorePendingTasks', 'NoMoreConcurrentTasks')):
                raise ApiError(429, f'{msg} (too many concurrent tasks: wait for one to finish; not retried)')
            if e.code == 429 and attempt < max_retries:
                delay = float(ra) if ra and re.match(r'^\d+(\.\d+)?$', ra) else min(60, 2 ** attempt)
                print(f'  rate limited, waiting {delay:.0f} s', file=sys.stderr)
                time.sleep(delay)
                continue
            if e.code >= 500 and attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise ApiError(e.code, f'{msg} ({HINTS.get(e.code, "")})'.replace(' ()', ''), ra)
        except urllib.error.URLError as e:
            if attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise ApiError(0, f'network error: {e.reason}')


def show_request(method, path, body):
    """Dry run: the request as it would be sent, with the key redacted."""
    def clip(v):
        if isinstance(v, str) and v.startswith('data:') and len(v) > 80:
            return v[:60] + f'... ({len(v)} characters)'
        return v
    print(f'{method} {API}{path}')
    print('Authorization: Bearer <MESHY_API_KEY, redacted>')
    if body is not None:
        print('Content-Type: application/json')
        print(json.dumps({k: clip(v) for k, v in body.items()}, indent=2))


def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def ms_iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).replace(microsecond=0).isoformat() if ms else None


def strip_query(u):
    """Asset URLs are signed and carry the account's id in the path. Keep only the host and the task-relative
    path for the record: no signature, no account id."""
    p = urllib.parse.urlsplit(u)
    parts = p.path.strip('/').split('/')
    if 'tasks' in parts:
        parts = ['<account>'] + parts[parts.index('tasks'):]
    else:
        parts = parts[-1:]
    return urllib.parse.urlunsplit((p.scheme, p.netloc, '/' + '/'.join(parts), '', ''))


def balance(key):
    b = request('GET', '/openapi/v1/balance', key=key)
    return b


# ---- task endpoints by kind ----
ENDPOINT = {'preview': '/openapi/v2/text-to-3d', 'refine': '/openapi/v2/text-to-3d', 'image': '/openapi/v1/image-to-3d',
            'rig': '/openapi/v1/rigging'}


def species_entry(sid):
    p = os.path.join(LIBRARY, f'{sid}.json')
    if os.path.isfile(p):
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    return None


def estimate(mode, body):
    model = body.get('ai_model', 'latest')
    if mode == 'preview':
        c = MESH_COST.get(model)
        return None if c is None else c + (5 if body.get('geometry_resolution') in ('2k', '4k') else 0)
    if mode == 'refine':
        return REFINE_COST.get(body.get('texture_resolution', '2k'))
    if mode == 'image':
        if body.get('should_texture', True):
            c = IMAGE_TEX_COST.get(model, {}).get(body.get('texture_resolution', '2k'))
        else:
            c = MESH_COST.get(model)
        return None if c is None else c + (5 if body.get('geometry_resolution') in ('2k', '4k') else 0)
    if mode == 'rig':
        return RIG_COST


def image_input(s):
    if re.match(r'^https?://', s) or s.startswith('data:'):
        return s
    if not os.path.isfile(s):
        sys.exit(f'--image: no such file or URL: {s}')
    if os.path.getsize(s) > 20 * 1024 * 1024:
        sys.exit('--image: Meshy accepts images up to 20 MB')
    mt = mimetypes.guess_type(s)[0]
    if mt not in ('image/png', 'image/jpeg', 'image/webp'):
        sys.exit('--image: Meshy accepts PNG, JPEG or WebP')
    with open(s, 'rb') as f:
        return f'data:{mt};base64,' + base64.b64encode(f.read()).decode()


def build_body(a):
    fmts = [f.strip() for f in a.formats.split(',') if f.strip()]
    if a.mode == 'preview':
        if not a.prompt:
            sys.exit('--mode preview needs --prompt')
        if len(a.prompt) > 800:
            sys.exit(f'--prompt is {len(a.prompt)} characters; Meshy accepts at most 800')
        b = {'mode': 'preview', 'prompt': a.prompt, 'ai_model': a.ai_model, 'target_formats': fmts}
        if a.model_type:
            b['model_type'] = a.model_type
        if a.geometry_resolution:
            b['geometry_resolution'] = a.geometry_resolution
    elif a.mode == 'refine':
        if not a.preview_job:
            sys.exit('--mode refine needs --preview-job <dir of a SUCCEEDED preview job>')
        pj = read_job(a.preview_job)
        if pj.get('mode') != 'preview' or pj.get('status') != 'SUCCEEDED':
            sys.exit('--preview-job must be a SUCCEEDED preview job')
        b = {'mode': 'refine', 'preview_task_id': pj['task_id'], 'texture_resolution': a.texture_resolution,
             'enable_pbr': a.enable_pbr, 'target_formats': fmts}
        if a.texture_prompt:
            b['texture_prompt'] = a.texture_prompt
        elif a.texture_image:
            b['texture_image_url'] = image_input(a.texture_image)
        b['_preview_model'] = pj.get('request', {}).get('ai_model', 'latest')
    elif a.mode == 'image':
        if not a.image:
            sys.exit('--mode image needs --image <file or URL>')
        b = {'image_url': image_input(a.image), 'ai_model': a.ai_model, 'should_texture': not a.no_texture,
             'target_formats': fmts}
        if not a.no_texture:
            b['texture_resolution'] = a.texture_resolution
            b['enable_pbr'] = a.enable_pbr
            if a.texture_prompt:
                b['texture_prompt'] = a.texture_prompt
        if a.model_type:
            b['model_type'] = a.model_type
        if a.geometry_resolution:
            b['geometry_resolution'] = a.geometry_resolution
    if a.mode in ('preview', 'image'):
        if a.should_remesh is not None:
            b['should_remesh'] = a.should_remesh == 'true'
        if a.topology:
            b['topology'] = a.topology
        if a.target_polycount:
            b['target_polycount'] = a.target_polycount
        if a.pose_mode is not None:
            b['pose_mode'] = a.pose_mode
    b['moderation'] = False
    return b


def read_job(d):
    p = os.path.join(d, 'job.json')
    if not os.path.isfile(p):
        sys.exit(f'no job.json in {d}')
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def write_job(d, job):
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, 'job.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(job, f, indent=2)
        f.write('\n')
    os.replace(tmp, os.path.join(d, 'job.json'))


def confirm(cost, a):
    if a.yes:
        return
    if not sys.stdin.isatty():
        sys.exit(f'this job costs about {cost} credits; pass --yes to submit without a prompt')
    if input(f'Submit this job for about {cost} credits? [y/N] ').strip().lower() not in ('y', 'yes'):
        sys.exit('not submitted')


def poll(kind, task_id, key, timeout_s):
    """Poll a task with backoff (5 s growing to 30 s; each poll is one request, far under the rate limit)."""
    path = f'{ENDPOINT[kind]}/{task_id}'
    t0, delay, last = time.time(), 5.0, None
    while True:
        t = request('GET', path, key=key)
        s, p = t.get('status'), t.get('progress')
        if (s, p) != last:
            print(f'  {s} {p}%', file=sys.stderr)
            last = (s, p)
        if s in ('SUCCEEDED', 'FAILED', 'CANCELED'):
            return t
        if time.time() - t0 > timeout_s:
            print(f'  still {s} after {timeout_s} s; resume later with `status --job <dir>`', file=sys.stderr)
            return t
        time.sleep(delay)
        delay = min(30.0, delay * 1.5)


def download(url, path):
    req = urllib.request.Request(url, headers={'User-Agent': UA})   # signed asset URL: no API key sent
    h = hashlib.sha256()
    n = 0
    with urllib.request.urlopen(req, timeout=300) as r, open(path + '.part', 'wb') as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
            f.write(chunk)
            n += len(chunk)
    os.replace(path + '.part', path)
    return {'file': os.path.basename(path), 'bytes': n, 'sha256': h.hexdigest(), 'source': strip_query(url)}


def ext_of(url, fallback):
    e = os.path.splitext(urllib.parse.urlsplit(url).path)[1].lower()
    return e if re.match(r'^\.[a-z0-9]{1,5}$', e) else fallback


def collect(job, task, d):
    """Download every model format, texture map and thumbnail the task reports."""
    files = []
    urls = []
    for fmt, u in (task.get('model_urls') or {}).items():
        if u:
            urls.append((f'model.{fmt}' if fmt != 'pre_remeshed_glb' else 'model_pre_remesh.glb', u))
    for i, tex in enumerate(task.get('texture_urls') or []):
        for ch, u in (tex or {}).items():
            if u:
                urls.append((f'texture{"_" + str(i) if i else ""}_{ch}{ext_of(u, ".png")}', u))
    res = task.get('result') or {}
    for k in ('rigged_character_glb_url', 'rigged_character_fbx_url'):
        if res.get(k):
            urls.append((k.replace('_url', '').replace('_glb', '.glb').replace('_fbx', '.fbx'), res[k]))
    for name, u in (res.get('basic_animations') or {}).items():
        if isinstance(u, str) and u:
            urls.append((name + ext_of(u, '.glb'), u))
    if task.get('thumbnail_url'):
        urls.append(('thumbnail' + ext_of(task['thumbnail_url'], '.png'), task['thumbnail_url']))
    for name, u in urls:
        name = re.sub(r'[^A-Za-z0-9_.-]', '_', name)
        print(f'  downloading {name}', file=sys.stderr)
        try:
            files.append(download(u, os.path.join(d, name)))
        except Exception as e:   # one failed file should not lose the others
            files.append({'file': name, 'error': str(e), 'source': strip_query(u)})
    for f in files:
        if f.get('file', '').endswith('.glb') and 'error' not in f:
            with open(os.path.join(d, f['file']), 'rb') as fh:
                if fh.read(4) != b'glTF':
                    f['warning'] = 'not a GLB (bad magic)'
    job['files'] = files


def finish(job, task, d, key):
    job['status'] = task.get('status')
    job['progress'] = task.get('progress')
    job['task'] = {k: task.get(k) for k in ('id', 'type', 'status', 'created_at', 'started_at', 'finished_at', 'expires_at',
                                             'consumed_credits', 'task_error', 'preceding_tasks', 'geometry_resolution')
                   if k in task}
    job['timestamps'].update({k: ms_iso(task.get(k)) for k in ('created_at', 'started_at', 'finished_at', 'expires_at')
                              if task.get(k)})
    if 'consumed_credits' in task:
        job['credits_charged'] = task['consumed_credits']
    if task.get('status') == 'SUCCEEDED' and not job.get('files'):
        collect(job, task, d)
        job['timestamps']['downloaded'] = now_iso()
    if task.get('status') in ('SUCCEEDED', 'FAILED', 'CANCELED'):
        try:
            job['balance_after'] = balance(key).get('balance')
        except ApiError as e:
            job['balance_after'] = f'unavailable: {e}'
    write_job(d, job)
    print(json.dumps({k: job.get(k) for k in ('task_id', 'status', 'credits_charged', 'balance_before', 'balance_after')}))
    if task.get('status') == 'FAILED':
        print(f'task failed: {(task.get("task_error") or {}).get("message")}', file=sys.stderr)
    print(d)


def cmd_generate(a):
    if not re.match(r'^[a-z][a-z0-9_]+$', a.species):
        sys.exit('--species must be a library id: lowercase scientific name with underscores, e.g. corvus_corax')
    entry = species_entry(a.species)
    if entry is None:
        print(f'note: library/animals/{a.species}.json does not exist yet; write the entry before adopting the model',
              file=sys.stderr)
    body = build_body(a)
    preview_model = body.pop('_preview_model', None)
    cost = estimate(a.mode, dict(body, ai_model=body.get('ai_model', preview_model or 'latest')))
    path = ENDPOINT[a.mode]
    print(f'estimated cost: {cost if cost is not None else "unknown"} credits ({PRICING_URL}, read {PRICING_READ})',
          file=sys.stderr)
    if a.dry_run:
        show_request('POST', path, body)
        return
    key = api_key()
    bal = balance(key).get('balance')
    print(f'balance: {bal} credits', file=sys.stderr)
    if cost is not None and bal is not None and bal < cost:
        sys.exit(f'balance {bal} is below the estimated cost {cost}')
    confirm(cost, a)
    submitted = now_iso()
    task_id = request('POST', path, body, key=key)['result']
    d = os.path.join(a.out or os.path.join(JOBS, a.species), task_id)
    record = dict(body)
    if 'image_url' in record and str(record['image_url']).startswith('data:'):
        record['image_url'] = f'(local file {os.path.basename(a.image)}, sent as a data URI)'
    if 'texture_image_url' in record and str(record['texture_image_url']).startswith('data:'):
        record['texture_image_url'] = f'(local file {os.path.basename(a.texture_image)}, sent as a data URI)'
    job = {
        'species': a.species, 'mode': a.mode, 'kind': 'text-to-3d' if a.mode in ('preview', 'refine') else 'image-to-3d',
        'task_id': task_id, 'endpoint': API + path, 'request': record,
        'prompt': body.get('prompt') or body.get('texture_prompt'),
        'image': a.image if a.mode == 'image' and a.image and not a.image.startswith('data:') else None,
        'preview_job': os.path.relpath(a.preview_job, ROOT) if a.preview_job else None,
        'estimated_credits': cost, 'balance_before': bal, 'status': 'SUBMITTED',
        'timestamps': {'submitted': submitted}, 'tool': 'tools/meshy_generate.py',
        'pricing_source': {'url': PRICING_URL, 'read': PRICING_READ},
        'licence_note': LICENCE_NOTE, 'maintainer': a.maintainer,
    }
    write_job(d, job)
    print(f'submitted {task_id}; job folder {os.path.relpath(d, ROOT)}', file=sys.stderr)
    task = poll(a.mode, task_id, key, a.timeout)
    finish(job, task, d, key)


def cmd_status(a):
    d = a.job
    job = read_job(d)
    key = api_key()
    kind = job['mode']
    task = poll(kind, job['task_id'], key, a.timeout) if a.wait else request('GET', f'{ENDPOINT[kind]}/{job["task_id"]}', key=key)
    finish(job, task, d, key)


def cmd_rig(a):
    """Meshy's auto-rigging is for textured humanoid (bipedal) characters only (docs.meshy.ai/en/api/rigging-and-animation).
    None of the library's body plans are humanoid, so this refuses unless --force; animals are posed by the procedural
    part rig instead (see docs/animal-library.md). Wired for completeness and for any future humanoid use."""
    job = read_job(a.job)
    entry = species_entry(job['species']) or {}
    plan = entry.get('body_plan', 'unknown')
    body = {'input_task_id': job['task_id'], 'height_meters': a.height_m}
    print(f'estimated cost: {RIG_COST} credits', file=sys.stderr)
    if plan != 'humanoid':
        print(f'warning: Meshy rigs humanoid characters only; {job["species"]} has body_plan "{plan}". Expect 422 '
              '(pose estimation failed). Use the procedural part rig (_PART/_PARTW/_PIVOT) instead.', file=sys.stderr)
    if job.get('mode') == 'preview':
        print('warning: Meshy rigs textured models only; rig a refine or a textured image-to-3D job', file=sys.stderr)
    if a.dry_run:
        show_request('POST', ENDPOINT['rig'], body)
        return
    if plan != 'humanoid' and not a.force:
        sys.exit('not submitted (pass --force to submit anyway)')
    key = api_key()
    bal = balance(key).get('balance')
    confirm(RIG_COST, a)
    task_id = request('POST', ENDPOINT['rig'], body, key=key)['result']
    d = os.path.join(a.job, 'rig_' + task_id)
    rjob = {'species': job['species'], 'mode': 'rig', 'kind': 'rigging', 'task_id': task_id, 'endpoint': API + ENDPOINT['rig'],
            'request': body, 'source_job': os.path.relpath(a.job, ROOT), 'estimated_credits': RIG_COST,
            'balance_before': bal, 'status': 'SUBMITTED', 'timestamps': {'submitted': now_iso()},
            'tool': 'tools/meshy_generate.py', 'licence_note': LICENCE_NOTE}
    write_job(d, rjob)
    task = poll('rig', task_id, key, a.timeout)
    finish(rjob, task, d, key)


def cmd_balance(a):
    b = balance(api_key())
    reset = ms_iso(b.get('monthly_resets_at')) if b.get('monthly_resets_at') else None
    print(json.dumps({'balance': b.get('balance'), 'monthly_credits': b.get('monthly_credits'),
                      'permanent_credits': b.get('permanent_credits'), 'monthly_resets_at': reset}, indent=2))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('balance', help='print the credit balance (free)')
    sub.add_parser('pricing', help='print the credit cost per job, with the doc URL and the date it was read')
    g = sub.add_parser('generate', help='submit a job, poll, download, write job.json')
    g.add_argument('--species', required=True, help='library id, e.g. corvus_corax')
    g.add_argument('--mode', required=True, choices=['preview', 'refine', 'image'])
    g.add_argument('--prompt', help='preview: the text prompt (max 800 characters)')
    g.add_argument('--image', help='image: reference image, a local PNG/JPEG/WebP (sent as a data URI) or a public URL')
    g.add_argument('--preview-job', help='refine: the folder of a SUCCEEDED preview job')
    g.add_argument('--texture-prompt', help='refine or image: texture prompt (max 800 characters)')
    g.add_argument('--texture-image', help='refine: texture reference image instead of a texture prompt')
    g.add_argument('--ai-model', default='latest', help='latest (meshy-7.1), meshy-6, meshy-6-lite (cheapest), meshy-t2, meshy-t2.5')
    g.add_argument('--model-type', choices=['standard', 'smart-topology', 'lowpoly'])
    g.add_argument('--geometry-resolution', choices=['standard', '2k', '4k'])
    g.add_argument('--topology', choices=['triangle', 'quad'])
    g.add_argument('--target-polycount', type=int)
    g.add_argument('--should-remesh', choices=['true', 'false'])
    g.add_argument('--pose-mode', choices=['', 'a-pose', 't-pose'])
    g.add_argument('--texture-resolution', default='2k', choices=['2k', '4k', '8k'])
    g.add_argument('--enable-pbr', action='store_true')
    g.add_argument('--no-texture', action='store_true', help='image: mesh only')
    g.add_argument('--formats', default='glb', help='comma-separated target formats (glb, obj, fbx, usdz, stl); default glb')
    g.add_argument('--out', help='parent folder; the job goes in <out>/<task_id>/ (default library/animals/jobs/<species>/)')
    g.add_argument('--maintainer', default=None, help='who ran the job, for credit')
    g.add_argument('--timeout', type=int, default=1800, help='seconds to poll before giving up (resume with status)')
    g.add_argument('--dry-run', action='store_true', help='print the request (key redacted) and the cost; send nothing')
    g.add_argument('--yes', action='store_true', help='submit without the cost prompt')
    s = sub.add_parser('status', help='check (or --wait for) a job, download its files when it has succeeded')
    s.add_argument('--job', required=True)
    s.add_argument('--wait', action='store_true')
    s.add_argument('--timeout', type=int, default=1800)
    r = sub.add_parser('rig', help='Meshy auto-rigging (humanoids only; refuses animals unless --force)')
    r.add_argument('--job', required=True)
    r.add_argument('--height-m', type=float, default=1.7)
    r.add_argument('--force', action='store_true')
    r.add_argument('--dry-run', action='store_true')
    r.add_argument('--yes', action='store_true')
    r.add_argument('--timeout', type=int, default=1800)
    a = ap.parse_args()
    try:
        if a.cmd == 'pricing':
            print(PRICING_TEXT)
        elif a.cmd == 'balance':
            cmd_balance(a)
        elif a.cmd == 'generate':
            cmd_generate(a)
        elif a.cmd == 'status':
            cmd_status(a)
        elif a.cmd == 'rig':
            cmd_rig(a)
    except KeyMissing as e:
        sys.exit(f'error: {e}')
    except ApiError as e:
        sys.exit(f'error: Meshy API {e}')
    except KeyboardInterrupt:
        sys.exit('interrupted; if a job was submitted, resume it with `status --job <dir> --wait`')


if __name__ == '__main__':
    main()
