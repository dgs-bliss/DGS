import concurrent.futures, json, os, re, subprocess, time, uuid
from pathlib import Path
from xml.etree import ElementTree as ET
from urllib.parse import urlsplit, quote

import requests

os.umask(0o077)
main=os.environ['GITHUB_SHA']
assert re.fullmatch(r'[a-f0-9]{40}',main)
site='www.digitalgrowthsociety.org'
cf='https://api.cloudflare.com/client/v4'
key=os.environ['CLOUDFLARE_API_TOKEN']
assert key, 'Missing production Cloudflare credential'
def get(path):
    r=requests.get(cf+path,headers={'Authorization':'Bearer '+key},timeout=18); d=r.json()
    assert r.ok and d.get('success'), (path,r.status_code,[e.get('code') for e in d.get('errors',[])])
    return d['result']
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==main
assert subprocess.check_output(['git','ls-remote','origin','refs/heads/main'],text=True,timeout=20).split()[0]==main
assert subprocess.check_output(['git','diff','--name-only','HEAD'],text=True).splitlines() in ([],['tina/tina-lock.json'])
zone,=get('/zones?name=digitalgrowthsociety.org'); a=zone['account']['id']; z=zone['id']
root=f'/accounts/{a}/workers/scripts/dgs-production'; route=f'/zones/{z}/workers/routes'; waf=f'/zones/{z}/rulesets/phases/http_request_firewall_custom/entrypoint'; stage=f'/accounts/{a}/workers/scripts/dgs/deployments'; dns=f'/zones/{z}/dns_records?name={site}'
def active(path): return get(path)['deployments'][0]['versions']
routes, rules, records, stage_versions=get(route),get(waf),get(dns),active(stage)
assert any(r['pattern']==site+'/*' and r.get('script')=='dgs-production' for r in routes)
prev,=active(root+'/deployments'); assert prev['percentage']==100
subdomain=get(root+'/subdomain'); assert subdomain=={'enabled':False,'previews_enabled':False},subdomain
bindings={v['name']:v for v in get(root+'/settings')['bindings']}
vars={k:v['text'] for k,v in bindings.items() if v['type']=='plain_text'}
assert vars['SITE_URL']=='https://'+site and vars['NEXT_PUBLIC_TINA_BRANCH']=='main'
required={k for k,v in bindings.items() if v['type']=='secret_text'}
assert {'TINA_TOKEN','RATE_LIMIT_SALT','TURNSTILE_SECRET_KEY','SMTP_PASSWORD'}<=required
token=os.environ['GH_TOKEN']
def gh(path):
    r=requests.get('https://api.github.com/repos/dgs-bliss/DGS'+path,headers={'Authorization':'Bearer '+token},timeout=15);r.raise_for_status();return r.json()
prs=[p for p in gh('/commits/'+main+'/pulls') if p['merged_at'] and p['base']['ref']=='main' and p['merge_commit_sha']==main]
assert len(prs)==1, 'Expected one merged PR for current main SHA'
pr=prs[0]; number=pr['number']; head=pr['head']['sha']
checks_by_name={c['name']:c['conclusion'] for c in reversed(gh('/commits/'+head+'/check-runs')['check_runs'])}
assert all(checks_by_name.get(n)=='success' for n in ('validate','Workers Builds: dgs')), 'Required PR checks did not pass'
assert any(r['type']=='pull_request' and r['parameters']['required_approving_review_count']>=1 for r in gh('/rules/branches/main')), 'Required review policy is missing'
assert subprocess.check_output(['git','rev-parse',main+'^'],text=True).strip()==os.environ['PREVIOUS_SHA'], 'Expected a single commit on protected main'
assert subprocess.check_output(['git','rev-list','--parents','-n1',main],text=True).count(' ')==1, 'Expected a squash merge'

# Build against the effective production project, not the preview project's defaults.
benv={k:v for k,v in os.environ.items() if k not in ('GH_TOKEN','CLOUDFLARE_API_TOKEN')}
benv.update({k:vars[k] for k in ('SITE_URL','NEXT_PUBLIC_TINA_BRANCH','NEXT_PUBLIC_TINA_CLIENT_ID','NEXT_PUBLIC_TINA_CONTENT_API_URL')})
assert urlsplit(vars['NEXT_PUBLIC_TINA_CONTENT_API_URL']).hostname==site
benv.update(WORKERS_CI='1',WORKERS_CI_BRANCH='main',DEPLOY_ADAPTER='cloudflare',GITHUB_CONTENT_REPO='dgs-bliss/DGS',SITE_PROVISION_MODE='same-site-migration',CI='1')
r=requests.post('https://content.tinajs.io/2.4/content/'+vars['NEXT_PUBLIC_TINA_CLIENT_ID']+'/github/main',headers={'X-API-KEY':benv['TINA_TOKEN']},json={'query':'query { page(relativePath:"home.mdx") { title } }'},timeout=15)
assert r.ok and (r.json().get('data') or {}).get('page'), 'Tina production read check failed'
for cmd in (['pnpm','dgs:homepage-lock'],['pnpm','test:apply-form'],['pnpm','build']): subprocess.run(cmd,env=benv,check=True,timeout=600)
assert any('const clientId = "'+vars['NEXT_PUBLIC_TINA_CLIENT_ID']+'"' in f.read_text() for f in Path('dist/server/chunks').glob('data_*.mjs')), 'Compiled Tina identity does not match production'
assert not Path('dist/server/.dev.vars').exists()
expected=json.loads(Path('dist/client/llm-json-ld.json').read_text())
marker='/release-sha.txt'; Path('dist/client'+marker).write_text(main+'\n')
changed=subprocess.check_output(['git','diff','--name-only','--diff-filter=AMR','-z',main+'^',main]).decode().split('\0')
public_changes=[p.removeprefix('public/') for p in changed if p.startswith('public/') and Path(p).is_file() and Path(p).name not in ('.assetsignore','_headers','_redirects')]
assets={'/'+quote(p,safe='/') for p in public_changes}
assert all(Path('dist/client',p).is_file() for p in public_changes), 'A changed public asset is missing from the build'
path=Path('dist/server/wrangler-dgs-live.json'); config=json.loads(Path('dist/server/wrangler.json').read_text()); config.update(name='dgs-production',topLevelName='dgs-production',workers_dev=False,preview_urls=False,vars=vars); config.pop('routes',None); path.write_text(json.dumps(config))
env={k:v for k,v in os.environ.items() if k not in ('GH_TOKEN','TINA_TOKEN','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET')}
env.update(CLOUDFLARE_API_TOKEN=key,CLOUDFLARE_ACCOUNT_ID=a,CI='1',WRANGLER_SEND_METRICS='false')
def wr(args):
    r=subprocess.run(['pnpm','exec','wrangler',*args,'--config',str(path),'--name','dgs-production'],env=env,capture_output=True,text=True,timeout=150)
    out=(r.stdout+'\n'+r.stderr).replace(key,'[REDACTED]')
    if r.returncode: print('\n'.join(out.splitlines()[-22:]),flush=True); r.check_returncode()
    return out

gp='https://api.globalping.io/v1/measurements'
def probe(region, route_path, test):
    q=requests.post(gp,json={'type':'http','target':site,'locations':[{'country':region}],'limit':1,'measurementOptions':{'protocol':'HTTPS','request':{'method':'GET','path':route_path,'query':'release_check='+uuid.uuid4().hex[:12]}}},timeout=10); q.raise_for_status(); mid=q.json()['id']
    for _ in range(10):
        q=requests.get(gp+'/'+mid,timeout=8); q.raise_for_status(); data=q.json()
        if data['status']=='finished' and data['results']:break
        time.sleep(1.5)
    else: return False
    row,=data['results']; r=row['result']; s=r.get('rawBody') or ''; headers={k.lower():v for k,v in (r.get('headers') or {}).items()}; ok=r.get('statusCode')==200 and (r.get('tls') or {}).get('authorized') and row['probe']['country']==region
    if ok:
        try: ok=bool(test(s,headers))
        except (ValueError,KeyError): ok=False
    print(region,row['probe']['city'],route_path,r.get('statusCode'),bool(ok),mid,flush=True)
    return mid if ok else False


asset=re.search(r'src="(/admin/assets/index-[^"]+\.js)"',Path('dist/client/admin/index.html').read_text())[1]
checks={'/':lambda s,h: all(i in s for i in ('"@graph"','"@type":"FAQPage"',site)), marker:lambda s,h:s.strip()==main,
        '/llm-json-ld.json':lambda s,h:json.loads(s)==expected, '/admin/':lambda s,h:asset in s,
        '/robots.txt':lambda s,h:bool(s.strip()), '/llms.txt':lambda s,h:bool(s.strip()),
        '/sitemap-index.xml':lambda s,h:'sitemapindex' in s, '/thank-you/':lambda s,h:'Thank you' in s}
checks.update({p:lambda s,h: 'text/html' not in h.get('content-type','') for p in assets if p not in checks and not p.endswith(('.html','.htm'))})
checks.update({p:lambda s,h:bool(s.strip()) for p in assets if p not in checks})
# Discover generated sitemap routes without trusting arbitrary off-site URLs.
for f in Path('dist/client').glob('sitemap*.xml'):
    for loc in ET.parse(f).iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc'):
        u=urlsplit(loc.text or '')
        assert u.scheme=='https' and u.netloc==site, 'Non-production URL in sitemap'
        checks.setdefault(u.path or '/',lambda s,h:bool(s.strip()))
assert probe('CA','/',lambda s,h:'Digital Growth Society' in s)
if '--build-only' in __import__('sys').argv[1:]:
    print(f'Production artifact validated without uploading; {len(checks)} URLs selected')
    raise SystemExit(0)
out=wr(['versions','upload','--no-bundle','--tag','dgs-'+main[:12],'--message',f'DGS production PR #{number} {main}'])
m=re.search(r'(?:Worker Version ID|Version ID):\s*([a-f0-9-]{36})',out)
assert m, 'Wrangler did not report a Worker version ID'
vid=m[1]; print('Uploaded',vid,flush=True)
v=get(root+'/versions/'+vid)
rb={i['name']:i for i in v.get('resources',{}).get('bindings',[])}
assert required <= {k for k,item in rb.items() if item['type']=='secret_text'}, sorted(rb)
assert all(rb[k].get('text')==val for k,val in vars.items())
assert rb['SESSION']['namespace_id']==bindings['SESSION']['namespace_id'] and rb['IMAGES']['type']==bindings['IMAGES']['type']
assert active(root+'/deployments')==[prev] and get(root+'/subdomain')==subdomain
assert gh('/branches/main')['commit']['sha']==main, 'Superseded before activation'
try:
    wr(['versions','deploy',vid+'@100','--yes','--message',f'Release approved PR #{number} to production']); print('Activated',vid,flush=True); time.sleep(20)
    pending=[(c,p) for c in ('CA','US') for p in checks]; proof={}
    for _ in range(3):
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            fs={pool.submit(probe,c,p,checks[p]):(c,p) for c,p in pending}
            for f in concurrent.futures.as_completed(fs):
                try:
                    if (m:=f.result()): proof[fs[f]]=m
                except requests.RequestException as e: print(type(e).__name__,flush=True)
        pending=[j for j in pending if j not in proof]
        if not pending:break
        time.sleep(7)
    assert not pending,pending
    assert active(root+'/deployments')==[{'version_id':vid,'percentage':100}]
    assert get(route)==routes and get(waf)==rules and get(dns)==records and active(stage)==stage_versions
    Path('dgs-production-proof.json').write_text(json.dumps({'version':vid,'sha':main,'previous':prev['version_id'],'probes':{' '.join(k):v for k,v in proof.items()}})); print('Production verified. Routing, DNS, firewall and staging unchanged.',flush=True)
except BaseException:
    if active(root+'/deployments')==[{'version_id':vid,'percentage':100}]:
        wr(['versions','deploy',prev['version_id']+'@100','--yes','--message','Rollback DGS homepage release']); assert active(root+'/deployments')==[prev]; print('Rolled back',prev['version_id'],flush=True); assert probe('CA','/',lambda s,h:'Digital Growth Society' in s)
    raise
