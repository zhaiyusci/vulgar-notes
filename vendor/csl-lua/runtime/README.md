# Lua CSL runtime

`lua-csl.wasm` is a WASI Preview 1 reactor. The application uses this precompiled
file in both the web and desktop builds; users do not need Lua, TeX Live, WSL,
Clang, or a WASI SDK. The original Lua, LPeg, and luautf8 C sources are included
under `src/`. Exact provenance and file hashes are in `manifest.json`.

The runtime is instantiated with `@bjorn3/browser_wasi_shim` 0.4.2, using its MIT
license option. Only in-memory standard descriptors are supplied. No real host
directory is preopened, no network interface is provided, and no TeX `kpse`
module exists. Lua's `package.searchers` retains only the explicit preload
loader. Packaged Lua modules are compiled by `vn_add_module` and executed lazily
by `require`. The application supplies its bundled Unicode text tables through
a separate, read-only Lua `datafile` adapter.

## Build

Use the pinned **wasi-sdk 34.0** release and a POSIX shell. This build was tested
on an existing x86-64 Linux WSL distribution, with the SDK extracted locally
without installing any system package. For example:

```sh
WASI_SDK_PATH=/path/to/wasi-sdk sh build.sh
```

Compilation uses relative source paths and a file-prefix map so the checkout's
absolute path is not embedded in the binary. The script writes the linked
reactor to `build/` before replacing `lua-csl.wasm`. Rebuilds with the pinned
toolchain and unchanged sources are expected to have the same SHA-256. After
intentional source or build changes, update the binary hash and file records in
`manifest.json`, then regenerate the TypeScript runtime asset.

The target is `wasm32-wasip1`. Lua's protected calls use the SDK's supported
`setjmp`/`longjmp` implementation, compiled with standard WebAssembly exception
handling (`-wasm-use-legacy-eh=false`). A runtime supporting standard WebAssembly
exception handling is required. The build reserves a 1 MiB C stack, starts with
4 MiB linear memory, and allows growth to 256 MiB.

No upstream C file is edited. `wasi-lua-config.h` provides build-only Lua
configuration for a single-threaded environment without operating-system
signals, shell execution, or writable temporary files. The only entry-symbol
rename is applied to the extended Unicode source alone:
`-Dluaopen_utf8=luaopen_luautf8`. This preserves Lua's standard `utf8` library
while registering the separate extended library as `require('lua-utf8')`.

## ABI

All pointers and lengths are 32-bit byte offsets/counts into exported `memory`.
Strings are length-delimited UTF-8, with no required trailing NUL. JavaScript
must recreate memory views after allocations or calls that may grow memory.

| Export | Purpose |
| --- | --- |
| `vn_alloc(size)` / `vn_free(pointer)` | Own and release input buffers. |
| `vn_init()` | Create the isolated Lua state; idempotent. |
| `vn_add_module(name, nameLength, source, sourceLength)` | Compile trusted source into `package.preload` without executing it. |
| `vn_run(source, sourceLength)` | Execute packaged trusted setup code that returns a string. |
| `vn_call(name, nameLength, input, inputLength)` | Call a trusted named global with input supplied as a Lua string, returning a string. |
| `vn_set_input(input, inputLength)` | Optional setup helper storing a Lua string as `VN_INPUT_JSON`. |
| `vn_output_ptr()` / `vn_output_len()` | Read the last result or error; valid until the next operation that replaces output. |
| `vn_status()` | Read the last status: 0 success, 1 Lua error, 2 initialization/allocation failure, 3 invalid function/result. |
| `vn_close()` | Release the Lua state and output. |

Document and bibliography data must cross through `vn_call` as data. Never
construct Lua source from document text, BibTeX fields, citation keys, or other
untrusted strings. `vn_run` and `vn_add_module` are exclusively for the packaged
program. The returned output is copied before the Lua stack is reset.

Third-party notices are distributed in `licenses/csl-lua/`; they are not
inserted into the writing interface or generated documents.
