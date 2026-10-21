"""Confined model storage for Studio-managed, streamed transfers."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import threading

LOCK = threading.Lock()
MAX_BYTES = 256 * 1024 ** 3

FOLDERS = {'checkpoints', 'clip_vision', 'diffusion_models', 'loras', 'text_encoders', 'vae'}
BUSY = set()


def directories(root, folder):
    if isinstance(root, dict):
        return [Path(path) for path in root.get(folder, [])]
    return [Path(root) / folder]


def target(root, folder, filename, subfolders=False):
    if not isinstance(folder, str) or folder not in FOLDERS or not isinstance(filename, str) or not re.fullmatch(r'[^\\\x00-\x1f]+\.(?:safetensors|gguf)', filename, re.I) or filename.startswith('.'):
        raise ValueError('Choose a supported model folder and filename.')
    parts = filename.split('/')
    if any(not part or part.startswith('.') for part in parts) or (len(parts) > 1 and not subfolders):
        raise ValueError('Invalid model path.')
    choices = directories(root, folder)
    if not choices:
        raise ValueError('This model folder is not configured on the worker.')
    directory = next((directory for directory in choices if (directory / filename).exists() or Path(str(directory / filename) + '.part').exists()), choices[0])
    root = directory.parent.resolve()
    if directory.is_symlink() or (directory.exists() and directory.resolve().parent != root):
        raise ValueError('Model folders must be inside the worker library.')
    directory = root / directory.name
    file = directory / filename
    if root not in file.resolve().parents or any(parent.is_symlink() for parent in file.parents if root in parent.parents):
        raise ValueError('Model paths must stay inside the worker library.')
    for candidate in [file, Path(str(file) + '.part'), Path(str(file) + '.part.json')]:
        if candidate.is_symlink():
            raise ValueError('Model symlinks cannot be changed.')
    return file


def digest(file):
    sha = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            sha.update(chunk)
    return sha.hexdigest()


def state(root, folder, filename, hash_file=False):
    file = target(root, folder, filename, subfolders=True)
    if hash_file:
        acquire(file)
    try:
        partial = Path(str(file) + '.part')
        note = Path(str(file) + '.part.json')
        result = {'size': file.stat().st_size if file.is_file() else 0, 'partialBytes': partial.stat().st_size if partial.is_file() else 0}
        if file.is_file():
            result['mtimeMs'] = file.stat().st_mtime * 1000
            if hash_file:
                result['sha256'] = digest(file)
        if note.is_file():
            try:
                parsed = json.loads(note.read_text())
                if isinstance(parsed, dict):
                    result['note'] = {key: parsed[key] for key in ['id', 'label', 'etag', 'lastModified', 'source', 'sha256', 'totalBytes', 'exact'] if key in parsed}
            except (ValueError, OSError):
                pass
        return result
    finally:
        if hash_file:
            release(file)


def inventory(root):
    files = []
    paused = []
    space = {}
    for folder in sorted(FOLDERS):
        for directory in directories(root, folder):
            if not directory.is_dir() or directory.is_symlink():
                continue
            for file in sorted(directory.rglob('*')):
                if file.is_symlink() or any(p.is_symlink() for p in file.parents if directory in p.parents):
                    continue
                if file.is_file() and file.suffix.lower() in {'.safetensors', '.gguf'}:
                    stat = file.stat()
                    files.append({'path': folder + '/' + file.relative_to(directory).as_posix(), 'size': stat.st_size, 'mtimeMs': stat.st_mtime * 1000})
                elif file.is_file() and file.name.endswith('.part.json') and file.parent == directory:
                    name = file.name[:-10]
                    try:
                        current = state(root, folder, name)
                    except (ValueError, OSError):
                        continue
                    if current['partialBytes']:
                        note = current.get('note', {})
                        paused.append({'id': str(note.get('id', '')), 'file': name, 'folder': folder, 'label': str(note.get('label', name)), 'status': 'paused', 'receivedBytes': current['partialBytes'], 'totalBytes': note.get('totalBytes', 0) if isinstance(note.get('totalBytes'), int) else 0})
            if folder not in space:
                space[folder] = {'free': shutil.disk_usage(directory).free, 'disk': str(directory.stat().st_dev)}
    writable = any(os.access(path, os.W_OK) for folder in FOLDERS for path in directories(root, folder))
    return {'files': files, 'paused': paused, 'space': space, 'writable': writable}


def acquire(file):
    with LOCK:
        if str(file) in BUSY:
            raise ValueError('The model is already being transferred or inspected.')
        BUSY.add(str(file))


def release(file):
    with LOCK:
        BUSY.discard(str(file))


def discard(root, folder, filename):
    file = target(root, folder, filename)
    acquire(file)
    try:
        for suffix in ['.part', '.part.json']:
            Path(str(file) + suffix).unlink(missing_ok=True)
    finally:
        release(file)


async def discard_when_idle(root, folder, filename):
    file = target(root, folder, filename)
    # A cancelled HTTP stream must release its writer before removing its partial.
    for _ in range(100):
        with LOCK:
            busy = str(file) in BUSY
        if not busy:
            discard(root, folder, filename)
            return
        await asyncio.sleep(0.1)
    raise ValueError('The active model transfer has not stopped yet.')


def preserve_replaced(root, folder, filename, expected):
    if not re.fullmatch('[a-fA-F0-9]{64}', expected):
        raise ValueError('A published SHA-256 checksum is required.')
    file = target(root, folder, filename)
    acquire(file)
    try:
        if file.exists() and digest(file) != expected.lower():
            # Explicit replacement retains the old file without replacing any existing backup.
            backup = Path(str(file) + '.previous.' + str(time.time_ns()))
            os.link(file, backup, follow_symlinks=False)
            file.unlink()
    finally:
        release(file)


async def receive(root, folder, filename, offset, expected_size, sha256, note, content):
    file = target(root, folder, filename)
    if offset < 0 or expected_size <= 0 or expected_size > MAX_BYTES or offset > expected_size or not re.fullmatch('[a-fA-F0-9]{64}', sha256):
        raise ValueError('A bounded transfer size and published SHA-256 checksum are required.')
    source = note.get('source', '')
    if not isinstance(source, str) or not re.fullmatch('[a-f0-9]{64}', source):
        raise ValueError('A source fingerprint is required.')
    acquire(file)
    try:
        if file.exists():
            if file.stat().st_size == expected_size and await asyncio.to_thread(digest, file) == sha256.lower():
                return {'already': True, 'size': expected_size}
            raise ValueError('A model already uses this filename. Replace it explicitly first.')
        file.parent.mkdir(parents=True, exist_ok=True)
        partial = Path(str(file) + '.part')
        metadata = Path(str(file) + '.part.json')
        if offset:
            saved = state(root, folder, filename)
            previous = saved.get('note', {})
            if saved['partialBytes'] != offset or any(previous.get(key) != value for key, value in {'source': source, 'sha256': sha256.lower(), 'totalBytes': expected_size}.items()):
                raise ValueError('The partial file or its source changed; restart the transfer.')
        if shutil.disk_usage(file.parent).free < expected_size - offset + 256 * 1024 * 1024:
            raise ValueError('The worker has insufficient free disk space.')
        allowed_note = {key: note[key][:1024] for key in ['id', 'label', 'etag', 'lastModified'] if key in note and isinstance(note[key], str)}
        allowed_note.update(totalBytes=expected_size, exact=True, source=source, sha256=sha256.lower())
        metadata.write_text(json.dumps(allowed_note))
        received = offset
        flags = os.O_WRONLY | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0) | (os.O_APPEND if offset else os.O_TRUNC)
        with os.fdopen(os.open(partial, flags, 0o600), 'ab' if offset else 'wb') as stream:
            async for chunk in content:
                if received + len(chunk) > expected_size:
                    raise ValueError('The transfer exceeds its declared size.')
                stream.write(chunk)
                received += len(chunk)
        if received != expected_size:
            raise ValueError('The transfer is incomplete; resume it to finish.')
        if await asyncio.to_thread(digest, partial) != sha256.lower():
            partial.unlink()
            metadata.unlink(missing_ok=True)
            raise ValueError('The model did not match its published checksum.')
        # A concurrently created destination must survive. link() fails if it exists.
        os.link(partial, file, follow_symlinks=False)
        partial.unlink()
        metadata.unlink(missing_ok=True)
        return {'size': received}
    finally:
        release(file)
