package local.anorlondo;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.util.ScreenshotRecorder;
import net.minecraft.world.GameMode;
import net.minecraft.world.attribute.EnvironmentAttributes;
import java.nio.file.*;
import java.util.Set;

/** Opt-in integration test. Refuses to open any save outside the isolated test directory. */
public final class WorldChecks {
    private static int phase=0,wait=40,elapsed=0;
    private static StringBuilder report=new StringBuilder();
    public static void tick(MinecraftClient client){
        if(!Boolean.getBoolean("anorlondo.worldCheck")||phase<0)return;
        try{
            if(!client.runDirectory.toPath().toAbsolutePath().normalize().endsWith("runtime-test"))throw new IllegalStateException("Integration test requires an isolated runtime-test directory");
            if(++elapsed>4800)throw new IllegalStateException("World checks exceeded four minutes");
            if(client.getOverlay()!=null||--wait>0)return;
            if(phase==0){phase=1;wait=40;client.createIntegratedServerLoader().start("example_world",()->fail(client,"World loading was cancelled"));return;}
            if(client.world==null||client.player==null||client.getServer()==null)return;
            if(phase==1){
                client.options.hudHidden=true;
                client.getTutorialManager().setStep(net.minecraft.client.tutorial.TutorialStep.NONE);
                client.getServer().execute(()->{client.getServer().getOverworld().setWeather(0,12000,true,true);client.getServer().getOverworld().setTimeOfDay(18000);});
                move(client,-650,10,-46);phase=2;wait=160;return;
            }
            client.world.setRainGradient(1);client.world.setThunderGradient(1);
            if(phase==2){
                check(AnorLondoAtmosphere.matchesWorld(client),"intended save matched");
                check(AnorLondoAtmosphere.weight()==1,"inside city full coverage");
                var attributes=client.gameRenderer.getCamera().getEnvironmentAttributeInterpolator();
                check(attributes.get(EnvironmentAttributes.SKY_COLOR_VISUAL,1)==AnorLondoAtmosphere.config.skyColor,"sky attribute is region gold");
                check(Math.abs(attributes.get(EnvironmentAttributes.SUN_ANGLE_VISUAL,1)-78)<0.01,"sun angle frozen locally");
                check(client.world.getRainGradient(1)==0&&client.world.getThunderGradient(1)==0,"rain and thunder suppressed locally");
                if(Boolean.getBoolean("anorlondo.testMusic")){
                    check(AnorLondoAtmosphere.MUSIC.available(),"music resource loaded");check(AnorLondoAtmosphere.MUSIC.playing(client),"streaming regional loop actually playing");
                    if(Boolean.getBoolean("anorlondo.threeTracks")){
                        for(String name:new String[]{"ambient","combat","dark"})check(client.getSoundManager().get(net.minecraft.util.Identifier.of("anorlondo",name))!=null,"registered music event "+name);
                        check(AnorLondoAtmosphere.MUSIC.currentTrack().equals("阳光公主"),"open sky chooses Gwynevere");
                    }
                }
                screenshot(client,"anor-golden.png");AnorLondoAtmosphere.config.enabled=false;phase=3;wait=60;return;
            }
            if(phase==3){
                check(AnorLondoAtmosphere.weight()==0,"off switch restores original view");
                check(client.world.getRainGradient(1)==1&&client.world.getThunderGradient(1)==1,"off switch restores original weather");
                if(Boolean.getBoolean("anorlondo.testMusic"))check(!AnorLondoAtmosphere.MUSIC.playing(client),"regional music stopped after fade");
                screenshot(client,"anor-vanilla.png");AnorLondoAtmosphere.config.enabled=true;move(client,-1000,72,-90);phase=4;wait=120;return;
            }
            if(phase==4){
                check(AnorLondoAtmosphere.matchesWorld(client)&&AnorLondoAtmosphere.weight()==0,"same save outside city is untouched");
                check(client.world.getRainGradient(1)==1&&client.world.getThunderGradient(1)==1,"outside weather preserved");
                screenshot(client,"outside-vanilla.png");move(client,-650,10,-46);AnorLondoAtmosphere.config.saveFolder="unmatched-test-save";phase=5;wait=100;return;
            }
            if(phase==5){
                check(!AnorLondoAtmosphere.matchesWorld(client)&&AnorLondoAtmosphere.weight()==0,"other save identity disables all region effects");
                check(client.world.getRainGradient(1)==1,"unmatched save weather preserved");
                if(Boolean.getBoolean("anorlondo.threeTracks")){
                    AnorLondoAtmosphere.config.saveFolder="example_world";
                    var server=client.getServer();var uuid=client.player.getUuid();
                    server.execute(()->{var world=server.getOverworld();var player=server.getPlayerManager().getPlayer(uuid);
                        // Only the isolated copy is modified: an opaque roof supplies genuine sky-light darkness.
                        for(int x=-666;x<=-634;x++)for(int z=-6;z<=26;z++)world.setBlockState(new net.minecraft.util.math.BlockPos(x,315,z),net.minecraft.block.Blocks.STONE.getDefaultState());
                        world.setBlockState(new net.minecraft.util.math.BlockPos(-650,312,10),net.minecraft.block.Blocks.STONE.getDefaultState());
                        player.teleport(world,-650,313,10,Set.of(),-46,12,true);
                    });phase=6;wait=160;return;
                }
                complete(client);return;
            }
            if(phase==6){
                check(client.world.getLightLevel(net.minecraft.world.LightType.SKY,client.player.getBlockPos())<=3,"roof produces real low sky light");
                check(AnorLondoAtmosphere.MUSIC.currentTrack().equals("黯影太阳")&&AnorLondoAtmosphere.MUSIC.playing(client),"dark interior streams Gwyndolin");
                var server=client.getServer();var uuid=client.player.getUuid();
                server.execute(()->{var world=server.getOverworld();var player=server.getPlayerManager().getPlayer(uuid);player.changeGameMode(GameMode.SURVIVAL);player.getAbilities().invulnerable=true;
                    var enemy=new net.minecraft.entity.mob.ZombieEntity(net.minecraft.entity.EntityType.ZOMBIE,world);enemy.setPosition(-649,313,10);enemy.setAiDisabled(true);enemy.setNoGravity(true);world.spawnEntity(enemy);enemy.setTarget(player);
                });phase=7;wait=100;return;
            }
            if(phase==7){
                check(AnorLondoAtmosphere.MUSIC.currentTrack().equals("翁斯坦与斯摩")&&AnorLondoAtmosphere.MUSIC.playing(client),"authoritative enemy target starts combat music over darkness");
                var server=client.getServer();var uuid=client.player.getUuid();server.execute(()->{var player=server.getPlayerManager().getPlayer(uuid);player.changeGameMode(GameMode.SPECTATOR);});phase=8;wait=120;return;
            }
            if(phase==8){
                check(AnorLondoAtmosphere.MUSIC.currentTrack().equals("黯影太阳")&&AnorLondoAtmosphere.MUSIC.playing(client),"combat ends and dark music returns");
                move(client,-1000,72,-90);phase=9;wait=120;return;
            }
            if(phase==9){
                check(!AnorLondoAtmosphere.MUSIC.playing(client)&&!AnorLondoAtmosphere.MUSIC.suppressVanilla(),"leaving city stops all regional tracks and restores vanilla");
                complete(client);return;
            }
        }catch(Throwable error){AnorLondoAtmosphere.LOG.error("Isolated world checks failed",error);fail(client,error.toString());}
    }
    private static void complete(MinecraftClient client){
                report.append("PASS: world integration complete; screenshots captured from a copy, original world never opened.\n");
                finish(client);return;
    }
    private static void check(boolean value,String label){if(!value)throw new AssertionError(label);report.append("PASS: ").append(label).append('\n');AnorLondoAtmosphere.LOG.info("World check: {}",label);}
    private static void move(MinecraftClient client,double x,double z,float yaw){
        var server=client.getServer();var uuid=client.player.getUuid();server.execute(()->{var player=server.getPlayerManager().getPlayer(uuid);if(player!=null){player.changeGameMode(GameMode.SPECTATOR);player.teleport(server.getOverworld(),x,335,z,Set.of(),yaw,12,true);}});
    }
    private static void screenshot(MinecraftClient client,String name){ScreenshotRecorder.saveScreenshot(client.runDirectory,name,client.getFramebuffer(),1,text->AnorLondoAtmosphere.LOG.info("Test screenshot: {}",text.getString()));}
    private static void fail(MinecraftClient client,String error){report.append("FAIL: ").append(error).append('\n');finish(client);}
    private static void finish(MinecraftClient client){phase=-1;try{Files.writeString(Path.of(System.getProperty("anorlondo.worldCheckOutput")),report.toString());}catch(Exception error){AnorLondoAtmosphere.LOG.error("Cannot write world check report",error);}client.scheduleStop();}
}
