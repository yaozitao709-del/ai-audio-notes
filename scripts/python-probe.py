"""Read environment metadata without installing or modifying anything."""
import importlib.metadata as metadata
import json
import platform
import site
import sys
import sysconfig
import os

packages = {}
distribution_paths = []
for distribution in metadata.distributions():
    name = distribution.metadata.get('Name')
    if name:
        key = name.lower().replace('_', '-').replace('.', '-')
        packages.setdefault(key, distribution.version)
        distribution_paths.append(str(distribution.locate_file('')))
paths = list(dict.fromkeys(list(site.getsitepackages()) + distribution_paths))
if site.ENABLE_USER_SITE:
    paths.append(site.getusersitepackages())
print(json.dumps({'executable': sys.executable, 'version': list(sys.version_info[:3]),
                  'arch': platform.machine(), 'packages': packages,
                  'prefix': sys.prefix, 'basePrefix': sys.base_prefix,
                  'sitePackages': sysconfig.get_path('purelib'),
                  'sitePaths': [p for p in paths if os.path.isdir(p)]}))
