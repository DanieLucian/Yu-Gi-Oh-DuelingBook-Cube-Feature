import importlib.util,subprocess,tempfile,os,json,zipfile,argparse,shutil,sys
sys.dont_write_bytecode=True
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('builder',repo/'scripts/build-zip-replacer.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
root=Path(tempfile.mkdtemp(prefix='dbcd-bat-tests-'))
parser=argparse.ArgumentParser();parser.add_argument('--pwsh',default=shutil.which('pwsh'));args=parser.parse_args()
if not args.pwsh:parser.error('PowerShell is required; pass --pwsh /path/to/pwsh')
pwsh=args.pwsh
env=os.environ.copy()
for key,folder in [('XDG_CACHE_HOME','cache'),('XDG_CONFIG_HOME','config'),('XDG_DATA_HOME','data')]:env.setdefault(key,str(root/folder))
payload=mod.POWERSHELL
bat=(repo/'scripts/Replace-Folder-From-Zip.bat').read_bytes()
assert bat.startswith(b'@echo off\r\n') and not any(c<32 and c not in (10,13) for c in bat)
expected=' '.join(line.strip() for line in payload.splitlines() if line.strip())
line=next(line for line in bat.decode('ascii').splitlines() if ' -Command ' in line)
assert line.split(' -Command ',1)[1]=='\"'+expected+'\"'
assert len(line)<7800
script=root/'test.ps1'
functions=payload[:payload.index("\ntry {\n    Add-Type -AssemblyName System.Windows.Forms")]
script.write_text(functions+r"""
function Move-Item {
    param([string]$LiteralPath,[string]$Destination)
    Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
    if($env:TEST_FAIL_INSTALL -and $LiteralPath -eq $env:TEST_DEST -and -not $script:CollisionCreated) {
        $script:CollisionCreated=$true
        [void][IO.Directory]::CreateDirectory($env:TEST_DEST)
        [IO.File]::WriteAllText((Join-Path $env:TEST_DEST 'new-work.txt'),'concurrent data')
    }
}
try {
    $b=Install-Zip $env:TEST_ZIP $env:TEST_DEST
    @{backup=$b} | ConvertTo-Json -Compress
} catch {Write-Host $_.Exception.Message;exit 1}
""")
parse=root/'parse.ps1';payloadfile=root/'payload.txt';payloadfile.write_text(payload)
parse.write_text("$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:PAYLOAD,[ref]$tokens,[ref]$errors); if($errors.Count){$errors | ForEach-Object {Write-Host $_.Message};exit 1}")
r=subprocess.run([pwsh,'-NoProfile','-File',str(parse)],env={**env,'PAYLOAD':str(payloadfile)},capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
print('Complete embedded PowerShell parses successfully.')

def run(name,files,ok=True,wrapper=False,self_inside=False,source_inside=False,symlink=False,fail_install=False):
 case=root/name;case.mkdir();dest=case/'project [1] with spaces';dest.mkdir();(dest/'old.txt').write_text('original')
 archive=(dest if source_inside else case)/'source [2].zip'
 with zipfile.ZipFile(archive,'w') as z:
  for file,data in files.items():z.writestr(('repo/' if wrapper else '')+file,data)
  if symlink:
   item=zipfile.ZipInfo('unsafe-link');item.create_system=3;item.external_attr=(0o120777<<16);z.writestr(item,'../outside')
 e={**env,'TEST_ZIP':str(archive),'TEST_DEST':str(dest)}
 if self_inside:e['DBCD_SELF']=str(dest/'updater.bat')
 if fail_install:e['TEST_FAIL_INSTALL']='1'
 r=subprocess.run([pwsh,'-NoProfile','-File',str(script)],env=e,capture_output=True,text=True)
 assert (r.returncode==0)==ok,(name,r.stdout,r.stderr)
 if ok:
  b=Path(json.loads(r.stdout.strip())['backup']);assert (b/'old.txt').read_text()=='original'
  assert not(dest/'old.txt').exists()
  for file,data in files.items():assert (dest/file).read_text()==data,(name,file)
  if source_inside:assert (b/archive.name).exists()
 else:
  assert (dest/'old.txt').read_text()=='original'
  assert not list(case.glob('*.backup-*'))
  if fail_install:
   recovered=list(case.glob('*.recovered-*'));assert len(recovered)==1
   assert (recovered[0]/'new-work.txt').read_text()=='concurrent data'
 assert not list(case.glob('.zip-update-*'))
 print(name,'PASS')
run('generic',{'new.txt':'new','nested/a.txt':'a','.hidden':'hidden'})
run('github-wrapper',{'manifest.json':'{}','content.js':'code'},wrapper=True)
run('empty',{},ok=False)
run('traversal',{'../escape.txt':'bad'},ok=False)
run('backslash-traversal',{r'..\escape.txt':'bad'},ok=False)
run('absolute',{'/outside.txt':'bad'},ok=False)
run('alternate-stream',{'file.txt:stream':'bad'},ok=False)
run('symlink',{'new.txt':'new'},ok=False,symlink=True)
run('self-inside',{'new.txt':'new'},ok=False,self_inside=True)
run('zip-inside-destination',{'new.txt':'new'},source_inside=True)
run('rollback',{'new.txt':'new'},ok=False,fail_install=True)
# Critical-root rejection happens before archive opening or mutation.
r=subprocess.run([pwsh,'-NoProfile','-File',str(script)],env={**env,'TEST_ZIP':'missing.zip','TEST_DEST':'/'},capture_output=True,text=True)
assert r.returncode!=0 and 'drive root' in r.stdout,r.stdout+r.stderr
print('drive-root PASS')
# A linked parent must not hide a protected physical destination.
case=root/'linked-parent';case.mkdir();protected=case/'simulated-system';protected.mkdir()
actual=protected/'project';actual.mkdir();(actual/'old.txt').write_text('protected')
alias=case/'innocent-alias';alias.symlink_to(protected,target_is_directory=True)
archive=case/'source.zip'
with zipfile.ZipFile(archive,'w') as z:z.writestr('replacement.txt','new')
r=subprocess.run([pwsh,'-NoProfile','-File',str(script)],env={**env,'windir':str(protected),'TEST_ZIP':str(archive),'TEST_DEST':str(alias/'project')},capture_output=True,text=True)
assert r.returncode!=0 and 'parent folders' in r.stdout,(r.stdout,r.stderr)
assert (actual/'old.txt').read_text()=='protected' and not(actual/'replacement.txt').exists()
assert not list(protected.glob('*.backup-*')) and not list(protected.glob('.zip-update-*'))
print('linked-parent PASS')
# The Explorer-style picker returns a placeholder filename in the chosen folder.
folder=case/'picker target';folder.mkdir()
choice=root/'choice.ps1';choice.write_text(functions+"\nGet-Destination $env:TEST_SELECTION")
for selection in [str(folder),str(folder/'Use this folder')]:
 r=subprocess.run([pwsh,'-NoProfile','-File',str(choice)],env={**env,'TEST_SELECTION':selection},capture_output=True,text=True)
 assert r.returncode==0 and r.stdout.strip()==str(folder),(r.stdout,r.stderr)
assert not list(folder.iterdir())
print('picker-folder-resolution PASS')
print('Fixture directory:',root)
