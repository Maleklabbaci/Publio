#!/usr/bin/env python3
"""Flux tar pour sauvegarde-complete.js. Ne pas appeler directement sur une instance active."""
import sys, os, json, tarfile, io, stat, pathlib, shutil

ROOTS = {'base', 'locataires', 'secrets', 'automatisations'}
MAX_FILES = 200000
MAX_TOTAL = 500 * 1024 * 1024 * 1024

def filter_source(info):
    name = info.name
    if not name or name.startswith('/') or '\\' in name or any(p in ('.','..') for p in name.split('/')):
        raise ValueError('Nom de fichier non portable refusé : ' + name)
    if not (info.isfile() or info.isdir()):
        raise ValueError('Lien ou fichier spécial refusé : ' + info.name)
    info.uid = info.gid = 0
    info.uname = info.gname = ''
    info.mode = 0o700 if info.isdir() else 0o600
    return info

def creer():
    spec = json.loads(os.environ['PUBLIO_ARCHIVE_SOURCES'])
    manifest = json.dumps({'format':'publio-sauvegarde-1','sources':[x['nom'] for x in spec]}, ensure_ascii=False).encode()
    with tarfile.open(fileobj=sys.stdout.buffer, mode='w|gz', compresslevel=6, dereference=False) as archive:
        info = tarfile.TarInfo('MANIFEST.json'); info.mode=0o600; info.size=len(manifest)
        archive.addfile(info, io.BytesIO(manifest))
        for source in spec:
            archive.add(source['chemin'], arcname=source['nom'], recursive=True, filter=filter_source)

def restaurer(archive_path, dest):
    seen=set(); total=0; count=0; manifest=False
    with tarfile.open(archive_path, mode='r:gz') as tar:
        for item in tar:
            count += 1
            if count > MAX_FILES: raise ValueError('Trop de fichiers dans la sauvegarde')
            name=item.name
            pure=pathlib.PurePosixPath(name)
            if (not name or name.startswith('/') or '\\' in name or any(p in ('..','.') for p in name.split('/'))
                or str(pure)!=name or (name!='MANIFEST.json' and pure.parts[0] not in ROOTS)):
                raise ValueError('Chemin refusé dans la sauvegarde')
            if name in seen: raise ValueError('Entrée en double dans la sauvegarde')
            seen.add(name)
            if not (item.isdir() or item.isfile()): raise ValueError('Lien ou fichier spécial refusé')
            if item.size < 0: raise ValueError('Taille invalide')
            total += item.size
            if total > MAX_TOTAL: raise ValueError('Sauvegarde trop volumineuse')
            if name=='MANIFEST.json':
                if not item.isfile() or item.size>65536: raise ValueError('Manifeste invalide')
                obj=json.loads(tar.extractfile(item).read())
                if obj.get('format')!='publio-sauvegarde-1': raise ValueError('Format inconnu')
                manifest=True; continue
            out=os.path.join(dest,*pure.parts)
            if item.isdir():
                os.makedirs(out, mode=0o700, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(out), mode=0o700, exist_ok=True)
                flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0)
                fd=os.open(out,flags,0o600)
                with os.fdopen(fd,'wb') as target, tar.extractfile(item) as src:
                    shutil.copyfileobj(src,target,length=1024*1024)
    if not manifest: raise ValueError('Manifeste manquant')
    for name in ('base/publio.json','base/locataires.json','locataires','secrets/secret'):
        if name not in seen: raise ValueError('Donnée requise absente : '+name)

if __name__ == '__main__':
    try:
        if sys.argv[1]=='creer': creer()
        elif sys.argv[1]=='restaurer': restaurer(sys.argv[2],sys.argv[3])
        else: raise ValueError('Mode inconnu')
    except Exception as e:
        print('Archive : '+str(e),file=sys.stderr);sys.exit(1)
