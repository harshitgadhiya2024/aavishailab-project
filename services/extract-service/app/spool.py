"""tempfile.SpooledTemporaryFile doesn't implement seekable()/readable()/
writable() before Python 3.11 (https://bugs.python.org/issue45785), even
though it fully supports seeking and reading through attribute delegation.
zipfile (and other stdlib format libraries) probe those methods via
hasattr() before accepting a file-like object, so without this shim every
archive extractor breaks the moment the real HTTP request body — spooled
through SpooledTemporaryFile — reaches them, even though the exact same
code works fine against a plain io.BytesIO in a unit test.
"""

from __future__ import annotations

import tempfile


class SeekableSpool:
    def __init__(self, max_size: int):
        self._f = tempfile.SpooledTemporaryFile(max_size=max_size)

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def writable(self) -> bool:
        return True

    def __getattr__(self, name):
        return getattr(self._f, name)
