import yaml
import os

# Validar workflow de deploy (scrape.yml ha sido migrado a ejecución manual en PC)
deploy_path = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..',
                           '.github', 'workflows', 'deploy-web.yml')
with open(deploy_path, 'r', encoding='utf-8') as f:
    deploy = yaml.safe_load(f)

print("Deploy keys:", list(deploy.keys()))
print("Deploy name:", deploy.get('name'))

deploy_on = deploy.get('on', {})
print("Deploy on keys:", list(deploy_on.keys()))

# Verificar que no haya workflow_run (debe haberse eliminado)
wr = deploy_on.get('workflow_run')
if wr:
    print("⚠️  WARNING: workflow_run aún presente en deploy-web.yml")
    print("  workflows:", wr.get('workflows'))
    print("  types:", wr.get('types'))
else:
    print("✅  Ningún workflow_run en deploy-web.yml (correcto)")

# Verificar triggers esperados
has_push = 'push' in deploy_on
has_dispatch = 'workflow_dispatch' in deploy_on
print(f"  push trigger: {'✅' if has_push else '❌'}")
print(f"  workflow_dispatch trigger: {'✅' if has_dispatch else '❌'}")

# Verificar paths
push_paths = deploy_on.get('push', {}).get('paths', [])
has_web = any(p.startswith('web/') for p in push_paths)
has_data = any(p.startswith('data/') for p in push_paths)
has_own_workflow = any('.github/workflows/deploy-web.yml' in p for p in push_paths)
print(f"  paths web/**: {'✅' if has_web else '❌'}")
print(f"  paths data/**: {'✅' if has_data else '❌'}")
print(f"  paths own workflow: {'✅' if has_own_workflow else '❌'}")