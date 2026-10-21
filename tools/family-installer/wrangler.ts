import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export type WranglerPaths = {
  nodeExecutable: string;
  wranglerScript: string;
  workingDirectory: string;
  configFile: string;
};

export type WranglerCommand = {
  args: readonly string[];
  timeoutMs: number;
  stdin?: string;
  secrets?: readonly string[];
  signal?: AbortSignal;
};

export type WranglerOutput = {
  stdout: string;
  stderr: string;
};

export class WranglerCommandError extends Error {
  constructor(
    public readonly reason: "start" | "exit" | "timeout" | "cancelled" | "invalid-json",
    public readonly mayHaveCompleted: boolean,
    message: string,
    public readonly exitCode?: number
  ) {
    super(message);
    this.name = "WranglerCommandError";
  }
}

export function parseWranglerJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    // JSON.parse errors can quote secret-bearing output. Do not retain their message or cause.
    throw new WranglerCommandError("invalid-json", true, "Не удалось прочитать ответ Wrangler как JSON.");
  }
}

function hideSecrets(text: string, command: WranglerCommand): string {
  const secrets = [command.stdin?.trim() ?? "", ...(command.secrets ?? [])].filter(value => value.length > 0).sort((a, b) => b.length - a.length);
  for (const secret of secrets)
    text = text.replaceAll(secret, "[скрыто]");
  return text;
}

function wranglerEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_USE_SYSTEM_CA"
  ]) {
    if (process.env[name] !== undefined)
      environment[name] = process.env[name];
  }
  return {
    ...environment,
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_HIDE_BANNER: "true",
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_SANITIZE: "true",
    CI: "true",
    NO_COLOR: "1"
  };
}

export async function runWrangler(paths: WranglerPaths, command: WranglerCommand): Promise<WranglerOutput> {
  if (command.signal?.aborted)
    throw new WranglerCommandError("cancelled", false, "Запуск Wrangler отменён.");
  const workingDirectory = path.resolve(paths.workingDirectory);
  const emptyEnvFile = path.join(workingDirectory, "wrangler-empty.env");
  try {
    await writeFile(emptyEnvFile, "");
  } catch {
    throw new WranglerCommandError("start", false, "Не удалось подготовить рабочую папку для Wrangler.");
  }
  if (command.signal?.aborted)
    throw new WranglerCommandError("cancelled", false, "Запуск Wrangler отменён.");
  return new Promise((resolve, reject) => {
    let started = false;
    let inputFailed = false;
    const child = execFile(path.resolve(paths.nodeExecutable), [
      path.resolve(paths.wranglerScript),
      ...command.args,
      `--config=${path.resolve(paths.configFile)}`,
      `--env-file=${emptyEnvFile}`
    ], {
      cwd: workingDirectory,
      env: wranglerEnvironment(),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: command.timeoutMs,
      signal: command.signal,
      killSignal: "SIGKILL"
    }, (error, stdout, stderr) => {
      if (!error && !inputFailed) {
        // Successful stdout is private command data; auth token --json can intentionally return a token.
        resolve({ stdout, stderr: hideSecrets(stderr, command) });
        return;
      }
      let reason: WranglerCommandError["reason"] = "exit";
      let message = inputFailed ? "Не удалось передать данные Wrangler." : "Wrangler завершился с ошибкой.";
      if (!started) {
        reason = "start";
        message = "Не удалось запустить Wrangler.";
      } else if (command.signal?.aborted) {
        reason = "cancelled";
        message = "Ожидание Wrangler отменено. Перед повтором проверьте, выполнена ли операция.";
      } else if (!inputFailed && error?.killed && error.code == null) {
        reason = "timeout";
        message = "Время ожидания Wrangler истекло. Перед повтором проверьте, выполнена ли операция.";
      }
      const exitCode = typeof error?.code === "number" ? error.code : undefined;
      if (exitCode !== undefined)
        message += ` Код завершения: ${exitCode}.`;
      const diagnostic = hideSecrets(stderr.trim(), command);
      // Never attach the original execFile error: it retains raw stdout, stderr and the command line.
      reject(new WranglerCommandError(reason, started, diagnostic ? `${message}\n${diagnostic}` : message, exitCode));
    });
    child.once("spawn", () => {
      started = true;
    });
    child.stdin!.on("error", () => {
      inputFailed = true;
      child.kill("SIGKILL");
    });
    child.stdin!.end(command.stdin);
  });
}
