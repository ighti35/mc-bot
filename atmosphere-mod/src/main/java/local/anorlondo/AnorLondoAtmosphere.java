package local.anorlondo;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.world.World;
import net.minecraft.util.WorldSavePath;
import net.minecraft.util.math.Vec3d;
import net.minecraft.text.Text;
import net.minecraft.world.attribute.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.nio.file.Path;

public final class AnorLondoAtmosphere implements ClientModInitializer {
    public static final Logger LOG=LoggerFactory.getLogger("AnorLondoAtmosphere");
    public static AtmosphereConfig config=new AtmosphereConfig();
    public static final Path CONFIG=FabricLoader.getInstance().getConfigDir().resolve("anor-londo-atmosphere.json");
    public static final RegionalMusic MUSIC=new RegionalMusic();
    private static boolean initialized=false;
    @Override public void onInitializeClient(){
        reload();initialized=true;
        ClientCommandRegistrationCallback.EVENT.register((dispatcher,registry)->dispatcher.register(ClientCommandManager.literal("anorlondo")
            .executes(ctx->{ctx.getSource().sendFeedback(Text.literal(status()));return 1;})
            .then(ClientCommandManager.literal("reload").executes(ctx->{boolean ok=reload();RegionalPostEffect.reset();MUSIC.reset(MinecraftClient.getInstance());ctx.getSource().sendFeedback(Text.literal(ok?"亚诺尔隆德区域氛围配置已重载":"配置无效，已禁用区域效果，详见日志"));return ok?1:0;}))
            .then(ClientCommandManager.literal("off").executes(ctx->{config.enabled=false;MUSIC.reset(MinecraftClient.getInstance());ctx.getSource().sendFeedback(Text.literal("区域氛围已关闭（本次运行）"));return 1;}))
            .then(ClientCommandManager.literal("music").executes(ctx->{boolean ok=MUSIC.enablePack(MinecraftClient.getInstance());ctx.getSource().sendFeedback(Text.literal(ok?"音乐包已启用，正在重载资源":"未找到 AnorLondoMusic 音乐包，请先导入本机原声音轨"));return ok?1:0;}))
            .then(ClientCommandManager.literal("on").executes(ctx->{config.enabled=true;ctx.getSource().sendFeedback(Text.literal("区域氛围已开启"));return 1;}))));
        LOG.info("Loaded: save={} bounds=[{},{}]..[{},{}]; client visuals only",config.saveFolder,config.minX,config.minZ,config.maxX,config.maxZ);
    }
    private static boolean reload(){try{config=AtmosphereConfig.load(CONFIG);return true;}catch(Exception error){config=new AtmosphereConfig();config.enabled=false;LOG.error("Invalid region configuration; effects disabled",error);return false;}}
    public static boolean matchesWorld(MinecraftClient client){
        if(!initialized||!config.enabled||client==null||client.world==null||client.getServer()==null)return false;
        if(!client.world.getRegistryKey().getValue().toString().equals(config.dimension))return false;
        Path root=client.getServer().getSavePath(WorldSavePath.ROOT).toAbsolutePath().normalize();
        return root.getFileName()!=null&&root.getFileName().toString().equals(config.saveFolder);
    }
    public static double weight(){
        MinecraftClient client=MinecraftClient.getInstance();
        if(!matchesWorld(client))return 0;
        Vec3d pos=client.gameRenderer.getCamera().getCameraPos();return config.weight(pos.x,pos.z);
    }
    public static double playerWeight(MinecraftClient client){return matchesWorld(client)&&client.player!=null?config.weight(client.player.getX(),client.player.getZ()):0;}
    public static double weatherWeight(World world){MinecraftClient client=MinecraftClient.getInstance();return world instanceof ClientWorld&&world==client.world&&config.clearWeather?weight():0;}
    public static Object attribute(EnvironmentAttribute<?> attribute,Object original){
        double w=weight();if(w<=0)return original;
        AtmosphereConfig c=config;
        if(attribute==EnvironmentAttributes.SKY_COLOR_VISUAL)return AtmosphereConfig.color((Integer)original,c.skyColor,w);
        if(attribute==EnvironmentAttributes.FOG_COLOR_VISUAL)return AtmosphereConfig.color((Integer)original,c.fogColor,w);
        if(attribute==EnvironmentAttributes.CLOUD_COLOR_VISUAL)return AtmosphereConfig.color((Integer)original,c.cloudColor,w);
        if(attribute==EnvironmentAttributes.SKY_LIGHT_COLOR_VISUAL)return AtmosphereConfig.color((Integer)original,c.skyLightColor,w);
        if(attribute==EnvironmentAttributes.SUNRISE_SUNSET_COLOR_VISUAL)return AtmosphereConfig.color((Integer)original,c.sunsetColor,w);
        if(attribute==EnvironmentAttributes.SUN_ANGLE_VISUAL)return AtmosphereConfig.angle((Float)original,c.sunAngle,w);
        if(attribute==EnvironmentAttributes.MOON_ANGLE_VISUAL)return AtmosphereConfig.angle((Float)original,c.sunAngle+180,w);
        if(attribute==EnvironmentAttributes.STAR_BRIGHTNESS_VISUAL)return AtmosphereConfig.blend((Float)original,0,w);
        if(attribute==EnvironmentAttributes.SKY_LIGHT_FACTOR_VISUAL)return AtmosphereConfig.blend((Float)original,c.skyLightFactor,w);
        if(attribute==EnvironmentAttributes.CLOUD_HEIGHT_VISUAL)return AtmosphereConfig.blend((Float)original,c.cloudHeight,w);
        float view=MinecraftClient.getInstance().options.getViewDistance().getValue()*16f;
        if(attribute==EnvironmentAttributes.FOG_START_DISTANCE_VISUAL)return AtmosphereConfig.blend((Float)original,Math.min(c.fogStart,view*0.75f),w);
        if(attribute==EnvironmentAttributes.FOG_END_DISTANCE_VISUAL)return AtmosphereConfig.blend((Float)original,Math.min(c.fogEnd,view*0.98f),w);
        // Leave water/lava, blindness, darkness and all gameplay attributes untouched.
        return original;
    }
    public static String status(){return "亚诺尔隆德氛围："+(matchesWorld(MinecraftClient.getInstance())?"当前存档匹配":"当前存档未匹配")+" · 覆盖 "+Math.round(weight()*100)+"% · BGM "+(MUSIC.available()?"已导入 · "+MUSIC.currentTrack():"缺少原声音轨")+" · 范围 X="+config.minX+".."+config.maxX+" Z="+config.minZ+".."+config.maxZ;}
}
