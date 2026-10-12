// Tests, e2e, and the demo run only the fake CLI (fake-claude.ts). A PATH lookup of claude ends the process.
// bunfig.toml preloads this file for bun test. serve.ts and demo.ts import it first.
import { tmpdir } from "node:os";
import { join } from "node:path";

// Skill discovery and the fake CLI never see the user's real Claude Code config folder. Nothing creates this folder. serve.ts sets a fixture folder.
process.env.CLAUDE_CONFIG_DIR = join(tmpdir(), "review-loop-no-claude-config");

const which = Bun.which.bind(Bun);
Bun.which = (command, options) => {
  if (/^claude(\.(exe|cmd|bat|ps1))?$/i.test(command)) {
    console.error(`no-real-claude: a ${command} lookup on PATH. Pass the fake CLI as runnerCommand.`);
    process.exit(1);
  }
  return which(command, options);
};
