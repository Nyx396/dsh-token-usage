import fs from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const core = (await fs.readFile(new URL('lib/core.js', root), 'utf8')).replaceAll('export ', '');
const client = await fs.readFile(new URL('src/panel.js', root), 'utf8');
const css = await fs.readFile(new URL('src/panel.css', root), 'utf8');
await fs.writeFile(new URL('lib/client.js', root), `window.__ModuleLoader__.load({id:'dsh-token-usage',factory:(require)=>{\nconst React=require('react');\n${core}\nconst CSS=${JSON.stringify(css)};\n${client}\nreturn {inject:['slots'],apply};\n}});\n`);
