import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { inspect } from "node:util";
import { parseWranglerJson, runWrangler, WranglerCommandError } from "../../../../tools/family-installer/wrangler";
import { createWranglerFixture, waitForWranglerStart } from "../../../infrastructure/installer/wranglerFixture";

test("Wrangler receives literal arguments and explicit files without inherited account or credential overrides", async context => {
  const paths = await createWranglerFixture(context, `
    const fs = require("node:fs");
    const args = process.argv.slice(2);
    process.stdout.write(JSON.stringify({
      args,
      cwd: process.cwd(),
      envFile: fs.readFileSync(args.find(arg => arg.startsWith("--env-file=")).slice(11), "utf8"),
      overrides: ["CLOUDFLARE_API_TOKEN", "CF_ACCOUNT_ID", "WRANGLER_API_BASE_URL", "NODE_OPTIONS"].map(name => process.env[name] ?? null),
      metrics: process.env.WRANGLER_SEND_METRICS,
      logs: process.env.WRANGLER_WRITE_LOGS,
      proxy: process.env.HTTPS_PROXY,
      certificates: process.env.NODE_EXTRA_CA_CERTS
    }));
    process.stderr.write("separate warning");
  `);
  const environment = {
    CLOUDFLARE_API_TOKEN: "unrelated-token",
    CF_ACCOUNT_ID: "unrelated-account",
    WRANGLER_API_BASE_URL: "https://wrong.invalid",
    NODE_OPTIONS: "--require=missing-preload.cjs",
    WRANGLER_WRITE_LOGS: "true",
    HTTPS_PROXY: "http://proxy.invalid:8080",
    NODE_EXTRA_CA_CERTS: paths.configFile
  };
  for (const [name, value] of Object.entries(environment)) {
    const previous = process.env[name];
    context.after(() => {
      if (previous === undefined)
        delete process.env[name];
      else
        process.env[name] = previous;
    });
    process.env[name] = value;
  }
  await writeFile(path.join(paths.workingDirectory, ".env"), "CLOUDFLARE_API_TOKEN=unrelated-file-token\n");
  const result = await runWrangler(paths, { args: ["d1", "create", "name with spaces & echo unexpected"], timeoutMs: 5000 });
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.args, [
    "d1",
    "create",
    "name with spaces & echo unexpected",
    `--config=${paths.configFile}`,
    `--env-file=${path.join(paths.workingDirectory, "wrangler-empty.env")}`
  ]);
  assert.equal(output.cwd, paths.workingDirectory);
  assert.equal(output.envFile, "");
  assert.deepEqual(output.overrides, [null, null, null, null]);
  assert.equal(output.metrics, "false");
  assert.equal(output.logs, "false");
  assert.equal(output.proxy, "http://proxy.invalid:8080");
  assert.equal(output.certificates, paths.configFile);
  assert.match(result.stderr, /separate warning/);
});

test("command errors keep the exit code and provider explanation without leaking supplied secrets", async context => {
  const paths = await createWranglerFixture(context, `
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      process.stdout.write("captured output: " + input);
      process.stderr.write("403 https://api.telegram.org/bot" + input.trim() + "/getMe cloudflare-test-secret");
      process.exitCode = 7;
    });
  `);
  const botToken = "123456789:synthetic-bot-token";
  await assert.rejects(runWrangler(paths, {
    args: ["secret", "put", "TELEGRAM_BOT_TOKEN"],
    stdin: botToken + "\n",
    secrets: ["cloudflare-test-secret"],
    timeoutMs: 5000
  }), error => {
    assert(error instanceof WranglerCommandError);
    assert.equal(error.reason, "exit");
    assert.equal(error.exitCode, 7);
    assert.equal(error.mayHaveCompleted, true);
    assert.match(error.message, /403/);
    assert(!inspect(error, { showHidden: true }).includes(botToken));
    assert(!inspect(error, { showHidden: true }).includes("cloudflare-test-secret"));
    return true;
  });
});

test("a timed-out command may already have changed data and is not run again", { timeout: 10000 }, async context => {
  const paths = await createWranglerFixture(context, `
    require("node:fs").appendFileSync("operation-started", "write\\n");
    setTimeout(() => process.exit(0), 3000);
  `);
  await assert.rejects(runWrangler(paths, { args: ["deploy"], timeoutMs: 1000 }), error => {
    assert(error instanceof WranglerCommandError);
    assert.equal(error.reason, "timeout");
    assert.equal(error.mayHaveCompleted, true);
    return true;
  });
  assert.equal(await readFile(path.join(paths.workingDirectory, "operation-started"), "utf8"), "write\n");
});

test("cancelling a running command reports that its change may already have happened", { timeout: 10000 }, async context => {
  const paths = await createWranglerFixture(context, `
    require("node:fs").writeFileSync("operation-started", "write");
    setTimeout(() => process.exit(0), 3000);
  `);
  const controller = new AbortController();
  const started = waitForWranglerStart(context, paths.workingDirectory);
  const rejected = assert.rejects(runWrangler(paths, {
    args: ["deploy"],
    timeoutMs: 5000,
    signal: controller.signal
  }), error => {
    assert(error instanceof WranglerCommandError);
    assert.equal(error.reason, "cancelled");
    assert.equal(error.mayHaveCompleted, true);
    return true;
  });
  await started;
  controller.abort();
  await rejected;
});

test("a missing executable is reported as not started", async context => {
  const paths = await createWranglerFixture(context, "process.exit(0)");
  await assert.rejects(runWrangler({ ...paths, nodeExecutable: path.join(paths.workingDirectory, "missing-node") }, {
    args: ["--version"],
    timeoutMs: 5000
  }), error => {
    assert(error instanceof WranglerCommandError);
    assert.equal(error.reason, "start");
    assert.equal(error.mayHaveCompleted, false);
    return true;
  });
});

test("a command cancelled before the call does not start or change data", async context => {
  const paths = await createWranglerFixture(context, 'require("node:fs").writeFileSync("operation-started", "write")');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runWrangler(paths, { args: ["deploy"], timeoutMs: 5000, signal: controller.signal }), error => {
    assert(error instanceof WranglerCommandError);
    assert.equal(error.reason, "cancelled");
    assert.equal(error.mayHaveCompleted, false);
    return true;
  });
  await assert.rejects(readFile(path.join(paths.workingDirectory, "operation-started")), { code: "ENOENT" });
});

test("JSON parsing leaves provider-specific validation to the calling operation and does not expose malformed output", () => {
  assert.deepEqual(parseWranglerJson('{"accounts":[{"id":"test-account"}]}'), { accounts: [{ id: "test-account" }] });
  const unexpectedOutput = "invalid JSON containing a synthetic-secret";
  assert.throws(() => parseWranglerJson(unexpectedOutput), error => {
    assert(error instanceof WranglerCommandError);
    assert.equal(error.reason, "invalid-json");
    assert.equal(error.mayHaveCompleted, true);
    assert(!inspect(error).includes("synthetic-secret"));
    return true;
  });
});

test("a Worker secret is sent through stdin without appearing in arguments", async context => {
  const paths = await createWranglerFixture(context, `
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      process.stdout.write(JSON.stringify({ input, args: process.argv.slice(2) }));
      process.stderr.write("warning containing " + input.trim());
    });
  `);
  const secret = "123456789:synthetic-bot-token";
  const result = await runWrangler(paths, {
    args: ["secret", "put", "TELEGRAM_BOT_TOKEN"],
    timeoutMs: 5000,
    stdin: secret + "\n"
  });
  const output = JSON.parse(result.stdout);
  assert.equal(output.input, secret + "\n");
  assert(!output.args.join(" ").includes(secret));
  assert(!result.stderr.includes(secret));
});
