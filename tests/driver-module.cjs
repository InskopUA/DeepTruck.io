const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),app=path.join(root,'driver-app');
const ts=require(path.join(app,'node_modules/typescript'));
function loadDriver(relative,mocks={},cache=new Map()){
 const file=path.resolve(app,relative);if(cache.has(file))return cache.get(file).exports;
 const instance=new Module(file,module);instance.filename=file;instance.paths=Module._nodeModulePaths(path.dirname(file));cache.set(file,instance);
 const original=instance.require.bind(instance);
 instance.require=id=>{
   if(Object.hasOwn(mocks,id))return mocks[id];
   if(id.endsWith('.png'))return {uri:'data:image/png;base64,'+fs.readFileSync(path.resolve(path.dirname(file),id)).toString('base64'),width:96,height:108};
   if(id.startsWith('.')){let resolved=path.resolve(path.dirname(file),id);for(const suffix of ['.ts','.tsx'])if(fs.existsSync(resolved+suffix))return loadDriver(path.relative(app,resolved+suffix),mocks,cache);}
   return original(id);
 };
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 instance._compile(code,file);return instance.exports;
}
module.exports={root,app,loadDriver};
