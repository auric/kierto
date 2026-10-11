// Tests, e2e, and the demo run only the fake CLI (fake-claude.ts). A PATH lookup of claude ends the process.
// bunfig.toml preloads this file for bun test. serve.ts and demo.ts import it first.
const which = Bun.which.bind(Bun);
Bun.which = (command, options) => {
  if (/^claude(\.(exe|cmd|bat|ps1))?$/i.test(command)) {
    console.error(`no-real-claude: a ${command} lookup on PATH. Pass the fake CLI as runnerCommand.`);
    process.exit(1);
  }
  return which(command, options);
};
