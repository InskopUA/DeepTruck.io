const {withPodfile}=require('expo/config-plugins');
const marker='# DeepTruck: align dependency resource bundles with the supported iOS target';
const block=`
    ${marker}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build|
        deployment = build.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if deployment && Gem::Version.new(deployment) < Gem::Version.new('15.1')
          build.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        end
      end
    end`;
module.exports=config=>withPodfile(config,mod=>{
  if(!mod.modResults.contents.includes(marker)){
    const anchor=/(:ccache_enabled[^\n]*\n\s*\))/;
    if(!anchor.test(mod.modResults.contents))throw new Error('Cannot configure the iOS dependency minimum target.');
    mod.modResults.contents=mod.modResults.contents.replace(anchor,'$1'+block);
  }
  return mod;
});
module.exports.block=block;
