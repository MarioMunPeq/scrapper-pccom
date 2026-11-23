import yaml

with open('.github/workflows/scrape.yml', 'r', encoding='utf-8') as f:
    scrape = yaml.safe_load(f)
with open('.github/workflows/deploy-web.yml', 'r', encoding='utf-8') as f:
    deploy = yaml.safe_load(f)

print("Scrape keys:", list(scrape.keys()))
print("Deploy keys:", list(deploy.keys()))
print("Scrape name:", scrape.get('name'))

deploy_on = deploy.get('on', {})
print("Deploy on keys:", list(deploy_on.keys()))
wr = deploy_on.get('workflow_run')
if wr:
    print("Deploy workflow_run found:")
    print("  workflows:", wr.get('workflows'))
    print("  types:", wr.get('types'))

scrape_name = scrape.get('name')
if scrape_name and wr:
    match = scrape_name in wr.get('workflows', [])
    print(f"Scrape name '{scrape_name}' in deploy workflows: {match}")
else:
    print("No se pudo verificar la coincidencia")