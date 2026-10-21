import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('speaker clustering resists outliers, retains recurring identities and handles short clips',()=>{
  const python=process.env.SPEAKER_PYTHON || fileURLToPath(new URL('../runtime/python/bin/python3',import.meta.url));
  const result=spawnSync(python,['-c',String.raw`
import numpy as np
from speaker_clustering import cluster_speakers
rng=np.random.default_rng(8)
a=np.zeros(192);a[0]=1
b=np.zeros(192);b[0]=.55;b[1]=np.sqrt(1-.55**2)
outlier=np.zeros(192);outlier[2]=1
# Two repeating normal voices plus two rare, distant artifacts.
x=np.vstack([a+rng.normal(0,.012,(300,192)), b+rng.normal(0,.012,(300,192)), a+rng.normal(0,.012,(198,192)),outlier,outlier])
x/=np.linalg.norm(x,axis=1,keepdims=True)
for count in [2,None]:
 labels=cluster_speakers(x,count)
 assert labels[0]!=labels[300], 'normal voices merged because of outliers'
 assert (labels[:300]==labels[0]).all()
 assert (labels[300:600]==labels[300]).all()
 assert (labels[600:798]==labels[0]).all()
 assert np.array_equal(labels,cluster_speakers(x,count)), 'unstable speaker identities'
assert len(set(cluster_speakers(x[:300])))==1
assert len(set(cluster_speakers(x[:10])))==1
assert cluster_speakers(x[:1]).tolist()==[0]
assert len(set(cluster_speakers(x,1)))==1
print('synthetic voice identities, artifacts, recurrence, determinism and single-speaker cases passed')
`],{cwd:fileURLToPath(new URL('.',import.meta.url)),env:{...process.env,OMP_NUM_THREADS:'2',OPENBLAS_NUM_THREADS:'2'},encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
