import { describe, expect, it } from 'vitest';
import { appReleasePlugin } from './appReleasePlugin';

describe('app release identity', () => {
  it('uses the exact same release in production HTML and the manifest', () => {
    const plugin = appReleasePlugin();
    const tags = (plugin.transformIndexHtml as Function)();
    let asset: any;
    (plugin.generateBundle as Function).call({emitFile: (value: unknown) => {asset=value;}});
    expect(JSON.parse(asset.source).version).toBe(tags[0].attrs.content);
    expect(asset.fileName).toBe('app-release.json');
    expect((appReleasePlugin().transformIndexHtml as Function)()[0].attrs.content).not.toBe(tags[0].attrs.content);
  });
  it('keeps HMR edits usable while server restarts receive a new identity', () => {
    const plugin=appReleasePlugin();
    let change: Function = () => {};
    let endpoint: Function = () => {};
    (plugin.configureServer as Function)({watcher:{on: (_: string, fn: Function) => {change=fn;}},middlewares:{use: (path: string, fn: Function) => {expect(path).toBe('/app-release.json');endpoint=fn;}}});
    const version=() => (plugin.transformIndexHtml as Function)()[0].attrs.content;
    const initial=version();
    expect(version()).toBe(initial);
    change('change','/repo/client/src/editor.test.ts');
    expect(version()).toBe(initial);
    change('change','/repo/client/src/editor.tsx');
    expect(version()).toBe(initial);
    expect((appReleasePlugin().transformIndexHtml as Function)()[0].attrs.content).not.toBe(initial);
    const headers: Record<string,string>={};
    let body='';
    endpoint({}, {setHeader:(k:string,v:string)=>{headers[k]=v;},end:(v:string)=>{body=v;}});
    expect(headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(body).version).toBe(version());
  });
});
