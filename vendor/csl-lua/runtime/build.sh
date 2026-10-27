#!/bin/sh
set -eu
cd "$(dirname "$0")"
SDK="${WASI_SDK_PATH:-/opt/wasi-sdk}"
CC="$SDK/bin/clang"
mkdir -p build/objects
# SDK 34 uses the standards-based WASI Preview 1 target name. Lua's C
# protected calls use SDK's native WebAssembly exception based setjmp/longjmp.
compile() {
  "$CC" --target=wasm32-wasip1 -Os \
    -include ./wasi-lua-config.h "-ffile-prefix-map=$PWD=." \
    -mllvm -wasm-enable-sjlj -mllvm -wasm-use-legacy-eh=false \
    -I ./src/lua -I ./src/lpeg "$@"
}
for source in src/lua/*.c; do
  case "$source" in */lua.c|*/luac.c) continue ;; esac
  compile -c "$source" -o "build/objects/lua-$(basename "$source" .c).o"
done
for source in src/lpeg/*.c; do
  compile -c "$source" -o "build/objects/lpeg-$(basename "$source" .c).o"
done
# Both the standard library and extended Unicode module originally export
# luaopen_utf8. Rename only the extended module; retain standard utf8.codes.
compile -Dluaopen_utf8=luaopen_luautf8 -c src/luautf8/lutf8lib.c -o build/objects/luautf8.o
compile -c bridge.c -o build/objects/bridge.o
"$CC" --target=wasm32-wasip1 -Os -mexec-model=reactor build/objects/*.o \
  -lsetjmp -lwasi-emulated-process-clocks -lm -Wl,-z,stack-size=1048576 -Wl,--initial-memory=4194304 \
  -Wl,--max-memory=268435456 -Wl,--export=vn_alloc -Wl,--export=vn_free \
  -Wl,--export=vn_init -Wl,--export=vn_add_module -Wl,--export=vn_set_input \
  -Wl,--export=vn_run -Wl,--export=vn_output_ptr -Wl,--export=vn_output_len \
  -Wl,--export=vn_call \
  -Wl,--export=vn_status -Wl,--export=vn_close -o build/lua-csl.wasm
mv build/lua-csl.wasm lua-csl.wasm
wc -c lua-csl.wasm
