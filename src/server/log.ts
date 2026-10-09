const secrets = new Set<string>();

// Every value given here is replaced in each later log line.
export function redact(value: string) {
  if (value) secrets.add(value);
}

// The only log output of the server. Never pass request headers.
export function log(message: string) {
  let line = message;
  for (const s of secrets) line = line.replaceAll(s, "[redacted]");
  console.log(line);
}
