/* No signals or shell/process spawning exist in the isolated runtime. */
#define l_signalT int
#define l_system(command) ((command) == NULL ? 0 : -1)
/* A formatter has no writable temporary filesystem. */
#define LUA_TMPNAMBUFSIZE 1
#define lua_tmpnam(buffer, error) ((void)(buffer), (error) = 1)
#define tmpfile vn_wasi_tmpfile
/* Lua os.clock is emulated using WASI's monotonic wall clock. */
#define _WASI_EMULATED_PROCESS_CLOCKS
