#include <stdint.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"

int luaopen_lpeg(lua_State *L);
int luaopen_luautf8(lua_State *L);

static lua_State *state;
static char *output;
static size_t output_len;
static int status;

FILE *vn_wasi_tmpfile(void) {
  errno = ENOSYS;
  return NULL;
}

static int finish(int code, const char *text, size_t length) {
  char *next = malloc(length + 1);
  free(output);
  output = next;
  output_len = next ? length : 0;
  status = next ? code : 2;
  if (next) {
    if (length) memcpy(next, text, length);
    next[length] = 0;
  }
  return status;
}

static int finish_literal(int code, const char *text) {
  return finish(code, text, strlen(text));
}

static int finish_lua_error(int code) {
  size_t length;
  const char *message = lua_tolstring(state, -1, &length);
  int result = message ? finish(code, message, length)
                       : finish_literal(code, "Lua error without a string message");
  lua_settop(state, 0);
  return result;
}

static int open_libraries(lua_State *L) {
  luaL_openlibs(L);
  luaL_requiref(L, "lpeg", luaopen_lpeg, 0);
  lua_pop(L, 1);
  luaL_requiref(L, "lua-utf8", luaopen_luautf8, 0);
  lua_pop(L, 1);
  /* Only explicit package.preload modules may be required. WASI is also
     instantiated without host directory preopens. No kpse is registered. */
  lua_getglobal(L, "package");
  lua_getfield(L, -1, "searchers");
  for (int i = 2; i <= 4; i++) {
    lua_pushnil(L);
    lua_rawseti(L, -2, i);
  }
  lua_pop(L, 2);
  return 0;
}

void *vn_alloc(size_t length) { return malloc(length ? length : 1); }
void vn_free(void *pointer) { free(pointer); }
uintptr_t vn_output_ptr(void) { return (uintptr_t)output; }
size_t vn_output_len(void) { return output_len; }
int vn_status(void) { return status; }

int vn_init(void) {
  if (state) return finish_literal(0, "");
  state = luaL_newstate();
  if (!state) return finish_literal(2, "Unable to create Lua state");
  lua_pushcfunction(state, open_libraries);
  if (lua_pcall(state, 0, 0, 0) != LUA_OK) return finish_lua_error(2);
  return finish_literal(0, "");
}

/* Compile trusted source now, but execute lazily through require(). */
int vn_add_module(const char *name, size_t name_len,
                  const char *source, size_t source_len) {
  if (!state && vn_init()) return status;
  lua_settop(state, 0);
  if (luaL_loadbufferx(state, source, source_len, "=registered-module", "t") != LUA_OK)
    return finish_lua_error(1);
  lua_getglobal(state, "package");
  lua_getfield(state, -1, "preload");
  lua_pushlstring(state, name, name_len);
  lua_pushvalue(state, 1);
  lua_rawset(state, -3);
  lua_settop(state, 0);
  return finish_literal(0, "");
}

/* JSON/user data crosses as a Lua string, never as executable source. */
int vn_set_input(const char *data, size_t length) {
  if (!state && vn_init()) return status;
  lua_pushlstring(state, data, length);
  lua_setglobal(state, "VN_INPUT_JSON");
  return finish_literal(0, "");
}

int vn_run(const char *source, size_t source_len) {
  if (!state && vn_init()) return status;
  lua_settop(state, 0);
  if (luaL_loadbufferx(state, source, source_len, "=trusted-bridge-call", "t") != LUA_OK)
    return finish_lua_error(1);
  if (lua_pcall(state, 0, 1, 0) != LUA_OK) return finish_lua_error(1);
  if (lua_type(state, -1) != LUA_TSTRING) {
    lua_settop(state, 0);
    return finish_literal(3, "Trusted Lua entry point must return a string");
  }
  size_t length;
  const char *text = lua_tolstring(state, -1, &length);
  int result = finish(0, text, length);
  lua_settop(state, 0);
  return result;
}

/* Invoke only a trusted global function. JSON remains a string argument. */
int vn_call(const char *name, size_t name_len,
            const char *input, size_t input_len) {
  if (!state && vn_init()) return status;
  lua_settop(state, 0);
  lua_pushglobaltable(state);
  lua_pushlstring(state, name, name_len);
  lua_rawget(state, -2);
  lua_remove(state, -2);
  if (!lua_isfunction(state, -1)) {
    lua_settop(state, 0);
    return finish_literal(3, "Named trusted Lua entry point is not a function");
  }
  lua_pushlstring(state, input, input_len);
  if (lua_pcall(state, 1, 1, 0) != LUA_OK) return finish_lua_error(1);
  if (lua_type(state, -1) != LUA_TSTRING) {
    lua_settop(state, 0);
    return finish_literal(3, "Trusted Lua entry point must return a string");
  }
  size_t length;
  const char *text = lua_tolstring(state, -1, &length);
  int result = finish(0, text, length);
  lua_settop(state, 0);
  return result;
}

void vn_close(void) {
  if (state) lua_close(state);
  state = NULL;
  free(output);
  output = NULL;
  output_len = 0;
  status = 0;
}
