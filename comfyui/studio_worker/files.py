"""File operations the Studio worker endpoints allow, kept free of ComfyUI imports for testing."""
import hmac
import os

MAX_FILES = 256
MEDIA_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.tif', '.tiff',
    '.mp4', '.webm', '.mov', '.mkv', '.m4v', '.flac', '.mp3', '.wav', '.ogg', '.opus', '.m4a', '.aac', '.latent',
}


def token_matches(expected, given):
    """No configured token accepts any caller, like the rest of ComfyUI's API."""
    if not expected:
        return True
    return isinstance(given, str) and hmac.compare_digest(expected.encode(), given.encode())


def resolve_target(bases, entry):
    """The absolute file an entry names, or None. Only media files inside a known folder, never via a dot folder."""
    if not isinstance(entry, dict):
        return None
    base = bases.get(entry.get('type', 'output'))
    filename = entry.get('filename')
    subfolder = entry.get('subfolder') or ''
    if not base or not isinstance(filename, str) or not isinstance(subfolder, str):
        return None
    if not filename or filename != os.path.basename(filename) or filename in ('.', '..'):
        return None
    if os.path.splitext(filename)[1].lower() not in MEDIA_EXTENSIONS:
        return None
    parts = [part for part in subfolder.replace('\\', '/').split('/') if part]
    if any(part.startswith('.') for part in parts) or os.path.isabs(subfolder):
        return None
    named = os.path.join(base, *parts, filename)
    # A link is never followed, even to a file inside the folder: only the file itself is named.
    if os.path.islink(named):
        return None
    root = os.path.realpath(base)
    target = os.path.realpath(named)
    if os.path.commonpath([root, target]) != root or target == root:
        return None
    return target


def delete_files(bases, entries):
    """Deletes each named file once; missing files count as already gone."""
    if not isinstance(entries, list) or len(entries) > MAX_FILES:
        raise ValueError(f'Send between 1 and {MAX_FILES} files.')
    deleted, missing, refused = 0, 0, 0
    for entry in entries:
        target = resolve_target(bases, entry)
        if target is None:
            refused += 1
            continue
        try:
            if os.path.isfile(target) and not os.path.islink(target):
                os.remove(target)
                deleted += 1
            else:
                missing += 1
        except FileNotFoundError:
            missing += 1
    return {'deleted': deleted, 'missing': missing, 'refused': refused}
