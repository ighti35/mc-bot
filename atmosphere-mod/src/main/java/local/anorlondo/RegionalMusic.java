package local.anorlondo;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.sound.AbstractSoundInstance;
import net.minecraft.client.sound.TickableSoundInstance;
import net.minecraft.client.sound.SoundInstance;
import net.minecraft.sound.SoundCategory;
import net.minecraft.util.Identifier;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.world.LightType;

public final class RegionalMusic {
    private enum Track {
        AMBIENT("ambient","阳光公主"), COMBAT("combat","翁斯坦与斯摩"), DARK("dark","黯影太阳");
        final Identifier event,file; final String label;
        Track(String name,String label){event=Identifier.of("anorlondo",name);file=Identifier.of("anorlondo","sounds/"+name+".ogg");this.label=label;}
    }
    private final boolean[] loaded=new boolean[Track.values().length];
    private Loop loop;
    private Loop fading;
    private boolean autoChecked=false;
    private volatile boolean combat=false;
    private volatile int generation=0;
    private Track candidate=Track.AMBIENT;
    private int candidateTicks=0;
    private boolean available=false;
    private int cooldown=0;
    private int playbackGrace=0;
    private boolean audioFailed=false;
    public boolean available(){return available;}
    public String currentTrack(){return loop==null?"未播放":loop.track.label;}
    public boolean playing(MinecraftClient client){return loop!=null&&client.getSoundManager().isPlaying(loop);}
    public boolean enablePack(MinecraftClient client){
        client.getResourcePackManager().scanPacks();
        String id="file/AnorLondoMusic";
        if(!client.getResourcePackManager().hasProfile(id))return false;
        client.getResourcePackManager().enable(id);
        if(!client.options.resourcePacks.contains(id))client.options.resourcePacks.add(id);
        client.options.write();reset(client);client.reloadResources();return true;
    }
    public void tick(MinecraftClient client){
        cooldown++;
        if(!autoChecked&&cooldown>=20&&client.getOverlay()==null){
            autoChecked=true;
            if(!client.options.resourcePacks.contains("file/AnorLondoMusic")&&enablePack(client))return;
        }
        if(cooldown%20==0){
            for(Track track:Track.values())loaded[track.ordinal()]=client.getResourceManager().getResource(track.file).isPresent()&&client.getSoundManager().get(track.event)!=null;
            available=!audioFailed&&loaded[Track.AMBIENT.ordinal()];
            updateCombat(client);
        }
        if(fading!=null&&fading.isDone()){client.getSoundManager().stop(fading);fading=null;}
        if(playbackGrace>0)playbackGrace--;
        double w=AnorLondoAtmosphere.config.music&&AnorLondoAtmosphere.config.musicVolume>0?AnorLondoAtmosphere.playerWeight(client):0;
        if(!available||w<=0){if(loop!=null){loop.target=0;if(loop.isDone()){client.getSoundManager().stop(loop);loop=null;}}return;}
        if(loop!=null&&!loop.isDone()&&!playing(client)&&playbackGrace<=0){
            stopLoops(client);available=false;audioFailed=true;
            AnorLondoAtmosphere.LOG.warn("Regional audio did not start; vanilla music retained. Fix the Vorbis file and run /anorlondo reload.");return;
        }
        Track wanted=select(combat,client.world.getLightLevel(LightType.SKY,client.player.getBlockPos())<=3);
        if(!loaded[wanted.ordinal()])wanted=Track.AMBIENT;
        if(candidate!=wanted){candidate=wanted;candidateTicks=0;}else candidateTicks++;
        // Combat starts promptly; a stable two-second light reading prevents doorway flicker.
        if(loop==null||loop.isDone()||(loop.track!=wanted&&(wanted==Track.COMBAT||candidateTicks>=40))){
            if(fading!=null){client.getSoundManager().stop(fading);fading=null;}
            if(loop!=null&&!loop.isDone()){fading=loop;fading.target=0;}else if(loop!=null)client.getSoundManager().stop(loop);
            client.getMusicTracker().stop();loop=new Loop(wanted);loop.target=(float)w*AnorLondoAtmosphere.config.musicVolume;playbackGrace=40;client.getSoundManager().play(loop);
        }
        loop.target=(float)w*AnorLondoAtmosphere.config.musicVolume;
    }
    public boolean suppressVanilla(){return available&&AnorLondoAtmosphere.config.music&&AnorLondoAtmosphere.config.musicVolume>0&&AnorLondoAtmosphere.playerWeight(MinecraftClient.getInstance())>0;}
    private static Track select(boolean combat,boolean dark){return combat?Track.COMBAT:dark?Track.DARK:Track.AMBIENT;}
    private void updateCombat(MinecraftClient client){
        if(AnorLondoAtmosphere.playerWeight(client)<=0||client.player==null){generation++;combat=false;return;}
        var server=client.getServer();var uuid=client.player.getUuid();int request=generation;
        // Read authoritative targets on the integrated server thread, not the render thread.
        server.execute(()->{
            var player=server.getPlayerManager().getPlayer(uuid);
            boolean active=player!=null&&player.isAlive()&&!player.isSpectator()&&(
                recent(player.getAttacker(),player,player.age-player.getLastAttackedTime(),200)||
                recent(player.getAttacking(),player,player.age-player.getLastAttackTime(),100)||
                !player.getEntityWorld().getEntitiesByClass(MobEntity.class,player.getBoundingBox().expand(24),mob->mob.isAlive()&&mob.getTarget()==player).isEmpty());
            if(generation==request)combat=active;
        });
    }
    private static boolean recent(LivingEntity enemy,LivingEntity player,int age,int limit){return enemy!=null&&enemy.isAlive()&&enemy!=player&&age>=0&&age<limit&&enemy.squaredDistanceTo(player)<24*24;}
    private void stopLoops(MinecraftClient client){if(loop!=null)client.getSoundManager().stop(loop);if(fading!=null)client.getSoundManager().stop(fading);loop=null;fading=null;}
    public void reset(MinecraftClient client){stopLoops(client);generation++;combat=false;available=false;cooldown=0;playbackGrace=0;audioFailed=false;candidate=Track.AMBIENT;candidateTicks=0;}
    private static final class Loop extends AbstractSoundInstance implements TickableSoundInstance {
        final Track track;
        float target=0;boolean done=false;
        Loop(Track track){super(track.event,SoundCategory.MUSIC,SoundInstance.createRandom());this.track=track;volume=0.001f;repeat=true;repeatDelay=0;relative=true;attenuationType=AttenuationType.NONE;}
        @Override public void tick(){volume+=Math.max(-0.015f,Math.min(0.015f,target-volume));if(target<=0&&volume<=0.001f){volume=0;done=true;}}
        @Override public boolean isDone(){return done;}
        @Override public boolean shouldAlwaysPlay(){return true;}
    }
}
