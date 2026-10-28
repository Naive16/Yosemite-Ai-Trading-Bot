export function runtimeEnv(request) {
  return request?.runtimeEnv || process.env;
}
