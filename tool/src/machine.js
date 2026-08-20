'use strict';
/* Machine result protocol (NAR-015-070..073, NAR-009-023).
 *
 * When the caller passes --json, exactly one JSON envelope is written to
 * stdout and nothing else; all human progress/prose is rerouted to stderr.
 * Without --json nothing here runs and human output is byte-for-byte
 * unchanged.
 *
 * Envelope (identity narova.result/1):
 *   { schema, operation, success, exit, data, diagnostics, artifacts }
 * Evolution within narova.result/1 is additive only; consumers ignore unknown
 * fields. Measured values (durations, byte counts) live inside data.
 *
 * Exit-status vocabulary (NAR-015-071):
 *   0 success · 1 operation failure · 2 usage error · 3 subject non-pass
 * Every condition that was nonzero before this protocol remains nonzero. */
const fs = require('fs');
const util = require('util');
const { assertRegistered } = require('./diagnostic-codes');

const ENVELOPE_SCHEMA = 'narova.result/1';

const EXIT = Object.freeze({
  success: 0,
  failure: 1,
  usage: 2,
  subjectNonPass: 3,
});

let session = null;

function isActive() {
  return session != null;
}

/* Begin machine mode for one invocation. Reroutes console.log/info and direct
 * process.stdout writes to stderr, captures stderr lines for fallback
 * diagnostics, and emits exactly one envelope from a process exit hook so
 * every exit path — early return, process.exitCode, or process.exit — is
 * covered uniformly. */
function begin(operation) {
  if (session) return session;
  const realStderrWrite = process.stderr.write.bind(process.stderr);

  session = {
    operation: operation || null,
    data: {},
    diagnostics: [],
    artifacts: [],
    stderrTail: [],
    emitted: false,
    secrets: new Set(),
  };

  const note = line => {
    session.stderrTail.push(line);
    if (session.stderrTail.length > 25) session.stderrTail.shift();
  };
  const prose = (...args) => {
    realStderrWrite(`${redactString(util.format(...args))}\n`);
  };
  console.log = prose;
  console.info = prose;
  console.error = (...args) => {
    const formatted = redactString(util.format(...args));
    note(formatted);
    realStderrWrite(`${formatted}\n`);
  };
  process.stdout.write = (chunk, encoding, callback) => {
    const cb = typeof encoding === 'function' ? encoding : callback;
    const text = Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === 'string' ? encoding : undefined) : String(chunk);
    const ok = realStderrWrite(redactString(text));
    if (typeof cb === 'function') cb();
    return ok;
  };
  process.stderr.write = (chunk, encoding, callback) => {
    const cb = typeof encoding === 'function' ? encoding : callback;
    const text = Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === 'string' ? encoding : undefined) : String(chunk);
    const ok = realStderrWrite(redactString(text));
    if (typeof cb === 'function') cb();
    return ok;
  };
  // The exit event carries the final status for both process.exit(code) and
  // natural termination (process.exitCode); emit is idempotent.
  process.once('exit', code => emit(code));
  return session;
}

/* Register credential values discovered from configuration whose environment
 * variable names are provider-defined and therefore cannot be recognized by a
 * name heuristic. Values are never retained outside this invocation. */
function secret(value) {
  if (!session || typeof value !== 'string' || value.length === 0) return;
  session.secrets.add(value);
}

function diag(severity, code, message, subject) {
  if (!session) return;
  if (!['info', 'warning', 'error'].includes(severity)) {
    throw new Error(`invalid machine diagnostic severity: ${severity}`);
  }
  assertRegistered(code);
  session.diagnostics.push({
    severity, code, message: String(message),
    ...(subject != null ? { subject: String(subject) } : {}),
  });
}

/* Merge fields into the data payload. */
function data(fields) {
  if (!session || !fields) return;
  Object.assign(session.data, fields);
}

/* Replace the data payload (report-shaped operations such as provenance). */
function setData(payload) {
  if (!session || !payload) return;
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('machine result data must be an object');
  }
  session.data = payload;
}

function artifact(path, role) {
  if (!session || !path) return;
  if (typeof role !== 'string' || !role) throw new Error('machine artifact role must be a non-empty string');
  const resolvedPath = String(path);
  // Artifact declarations describe the terminal, project-visible result, not
  // paths that were planned, removed, or intentionally omitted.
  if (!fs.existsSync(resolvedPath)) return;
  const entry = { path: resolvedPath, role };
  if (!session.artifacts.some(a => a.path === entry.path && a.role === role)) {
    session.artifacts.push(entry);
  }
}

function fallbackCode(exitCode) {
  if (exitCode === EXIT.usage) return 'usage.invalid';
  if (exitCode === EXIT.subjectNonPass) return 'subject.non-pass';
  return 'operation.failed';
}

function exitClass(exitCode) {
  if (exitCode === EXIT.success) return 'success';
  if (exitCode === EXIT.usage) return 'usage-error';
  if (exitCode === EXIT.subjectNonPass) return 'subject-non-pass';
  return 'operation-failure';
}

const SECRET_ENV_NAME = /(api[_-]?key|token|secret|pass(?:word|wd)?|credential|authorization)/i;
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi;

function redactUrl(raw) {
  // Keep prose punctuation outside the parsed URL so an embedded URL can be
  // sanitized without rewriting the surrounding diagnostic text.
  const trailing = raw.match(/[),.;\]}]+$/)?.[0] || '';
  const candidate = trailing ? raw.slice(0, -trailing.length) : raw;
  try {
    const url = new URL(candidate);
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    // OAuth implicit flows and some signed links carry credentials in the
    // fragment. Fragments are never sent to the server and are not needed for
    // machine diagnostics, so omit them entirely.
    url.hash = '';
    // Query values are untrusted capability material. Preserve parameter names
    // for diagnosis, but redact values by default; a denylist cannot cover
    // OAuth `code`, provider-specific session tickets, or future signers.
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[REDACTED]');
    return `${url.toString()}${trailing}`;
  } catch {
    return raw;
  }
}

function redactString(value) {
  let redacted = String(value);
  for (const [name, secret] of Object.entries(process.env)) {
    if (!SECRET_ENV_NAME.test(name) || typeof secret !== 'string' || secret.length < 4) continue;
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  for (const registered of session?.secrets || []) {
    if (registered.length >= 4) {
      redacted = redacted.split(registered).join('[REDACTED]');
    } else {
      // Replacing every occurrence of a one-character credential would corrupt
      // ordinary protocol words and paths. Short values are redacted when they
      // appear as standalone prose/JSON tokens.
      const escaped = registered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      redacted = redacted.replace(new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, 'g'), '$1[REDACTED]');
    }
  }
  return redacted.replace(URL_IN_TEXT, redactUrl);
}

/* Sanitize captured child-process prose before it is replayed to stderr.
 * Envelope values are sanitized again at emission; this public helper covers
 * the other machine-mode output channel without exposing the secret set. */
function redact(value) {
  return redactString(value);
}

function redactValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[REDACTED circular value]';
  seen.add(value);
  const redacted = Array.isArray(value)
    ? value.map(item => redactValue(item, seen))
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      SECRET_ENV_NAME.test(key) ? '[REDACTED]' : redactValue(child, seen),
    ]));
  seen.delete(value);
  return redacted;
}

function envelopeFor(exitCode) {
  const ok = exitCode === 0;
  const diagnostics = session.diagnostics.slice();
  if (!ok && !diagnostics.some(d => d.severity === 'error')) {
    const last = session.stderrTail[session.stderrTail.length - 1];
    diagnostics.push({
      severity: 'error',
      code: fallbackCode(exitCode),
      message: last || (ok ? '' : 'operation failed'),
    });
  }
  return redactValue({
    schema: ENVELOPE_SCHEMA,
    operation: session.operation,
    success: ok,
    exit: { code: exitCode, class: exitClass(exitCode) },
    data: session.data,
    diagnostics,
    artifacts: session.artifacts,
  });
}

/* Write the envelope as the complete stdout content. Idempotent: whichever
 * exit path fires first (process.exit interception or normal return) wins. */
function emit(exitCode) {
  if (!session || session.emitted) return;
  session.emitted = true;
  try {
    fs.writeSync(1, `${JSON.stringify(envelopeFor(exitCode), null, 2)}\n`);
  } catch (error) {
    // Envelope emission must never undo a completed operation: report on
    // stderr and let the original exit status stand (NAR-009-025 precedent).
    process.stderr.write(`machine envelope could not be written: ${error.message}\n`);
  }
}

/* Minimal envelope for pre-dispatch usage errors (NAR-015-071): emitted when
 * --json was requested but argument parsing failed before a session existed. */
function emitUsageEnvelope(operation, message) {
  const envelope = redactValue({
    schema: ENVELOPE_SCHEMA,
    operation: operation || null,
    success: false,
    exit: { code: EXIT.usage, class: exitClass(EXIT.usage) },
    data: {},
    diagnostics: [{ severity: 'error', code: 'usage.invalid', message: String(message) }],
    artifacts: [],
  });
  try {
    fs.writeSync(1, `${JSON.stringify(envelope, null, 2)}\n`);
  } catch { /* stderr already carries the usage message */ }
}

module.exports = {
  ENVELOPE_SCHEMA, EXIT,
  isActive, begin, secret, redact, diag, data, setData, artifact, emit, emitUsageEnvelope,
};
