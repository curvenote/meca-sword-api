#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { SwordClient } from '@curvenote/sword-client';
import { SwordError } from '@curvenote/sword-common';
import { buildMecaFromFiles, inspectMeca } from '@curvenote/sword-common/meca';
import { exampleMeca } from './example.js';

const program = new Command('meca-sword').description(
  'Build MECA packages and deposit them over SWORD v3',
);

const auth = (cmd: Command) =>
  cmd
    .option('-u, --username <username>', 'username (env SWORD_USERNAME)')
    .option('-p, --password <password>', 'password (env SWORD_PASSWORD)')
    .option('-k, --api-key <key>', 'API key, instead of username/password (env SWORD_API_KEY)');

function client(url: string, opts: { username?: string; password?: string; apiKey?: string }) {
  return new SwordClient({
    serviceUrl: url,
    username: opts.username ?? process.env.SWORD_USERNAME,
    password: opts.password ?? process.env.SWORD_PASSWORD,
    apiKey: opts.apiKey ?? process.env.SWORD_API_KEY,
  });
}

auth(
  program
    .command('send <file> <serviceUrl>')
    .description('Deposit a MECA zip at a SWORD Service-URL (or a collection Service-URL)')
    .option('--slug <slug>', 'suggested identifier for the new object')
    .option('--wait', 'wait until the receiver ingests or rejects the deposit'),
).action(async (file: string, serviceUrl: string, opts) => {
  const data = new Uint8Array(fs.readFileSync(file));
  const inspection = inspectMeca(data);
  if (!inspection.valid) fail(`Not a valid MECA package:\n  ${inspection.errors.join('\n  ')}`);
  for (const w of inspection.warnings) console.warn(`warning: ${w}`);
  const c = client(serviceUrl, opts);
  const result = await c.depositMeca(data, { filename: path.basename(file), slug: opts.slug });
  console.log(`Deposited ${path.basename(file)}`);
  console.log(`  Object-URL: ${result.location}`);
  console.log(`  State:      ${result.status.state.map((s) => s['@id']).join(', ')}`);
  if (opts.wait) {
    const status = await c.waitForState(result.location, undefined, { timeout: 24 * 3600_000 });
    console.log(`  Final:      ${status.state.map((s) => s['@id']).join(', ')}`);
  }
});

auth(
  program.command('status <objectUrl>').description('Show the status document of a deposit'),
).action(async (objectUrl: string, opts) => {
  console.log(JSON.stringify(await client(objectUrl, opts).getStatus(objectUrl), null, 2));
});

auth(program.command('service <serviceUrl>').description('Show a SWORD service document')).action(
  async (serviceUrl: string, opts) => {
    console.log(JSON.stringify(await client(serviceUrl, opts).getServiceDocument(), null, 2));
  },
);

program
  .command('inspect <file>')
  .description('Check a MECA zip and print what a receiver would extract')
  .action((file: string) => {
    const { files, ...rest } = inspectMeca(new Uint8Array(fs.readFileSync(file)));
    console.log(JSON.stringify({ ...rest, fileCount: files.length }, null, 2));
    if (!rest.valid) process.exitCode = 1;
  });

program
  .command('build <inputs...>')
  .description(
    'Build a MECA zip from a JATS XML and its files (or a folder or zip of them); roles are inferred',
  )
  .option('-o, --out <file>', 'output file (default <uuid>-meca.zip)')
  .action((inputs: string[], opts: { out?: string }) => {
    const files = inputs.flatMap((input) => readInputs(input));
    const result = buildMecaFromFiles(files);
    for (const note of result.notes) console.log(note);
    for (const w of result.inspection.warnings) console.warn(`warning: ${w}`);
    if (!result.inspection.valid) fail(result.inspection.errors.join('\n'));
    const out = opts.out ?? `${crypto.randomUUID()}-meca.zip`;
    fs.writeFileSync(out, result.data);
    console.log(`Wrote ${out}`);
  });

function readInputs(input: string): { path: string; data: Uint8Array }[] {
  if (!fs.statSync(input).isDirectory()) {
    return [{ path: path.basename(input), data: new Uint8Array(fs.readFileSync(input)) }];
  }
  return (fs.readdirSync(input, { recursive: true }) as string[])
    .filter((rel) => fs.statSync(path.join(input, rel)).isFile())
    .map((rel) => ({
      path: rel.split(path.sep).join('/'),
      data: new Uint8Array(fs.readFileSync(path.join(input, rel))),
    }));
}

program
  .command('example [file]')
  .description('Write a small example MECA package (default: example-meca.zip)')
  .action((file = 'example-meca.zip') => {
    fs.writeFileSync(file, exampleMeca());
    console.log(`Wrote ${file}`);
  });

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

program.parseAsync().catch((error) => {
  if (error instanceof SwordError) {
    fail(`${error.type} (${error.status}): ${error.message}${error.log ? `\n${error.log}` : ''}`);
  }
  fail(String(error instanceof Error ? error.message : error));
});
