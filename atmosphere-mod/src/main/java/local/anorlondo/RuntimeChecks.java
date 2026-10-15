package local.anorlondo;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gl.PostEffectProcessor;
import net.minecraft.client.util.memory.ObjectPool;
import net.minecraft.util.Identifier;
import com.mojang.blaze3d.systems.RenderSystem;
import local.anorlondo.mixin.PostProcessorAccessor;
import local.anorlondo.mixin.PostPassAccessor;
import java.nio.*;
import java.nio.file.*;
import java.util.Set;
public final class RuntimeChecks {
    private static int ticks=0;
    private static boolean finished=false;
    public static void tick(MinecraftClient client){
        if(finished||!Boolean.getBoolean("anorlondo.selftest")||client.world!=null||client.getOverlay()!=null||++ticks<40)return;
        finished=true;
        String result;
        try(var pool=new ObjectPool(2)){
            var effect=client.getShaderLoader().loadPostEffect(Identifier.of("anorlondo","golden"),Set.of(PostEffectProcessor.MAIN));
            if(effect==null)throw new IllegalStateException("ShaderLoader rejected the regional pipeline");
            var passes=((PostProcessorAccessor)effect).anor$getPasses();
            if(passes.size()!=2)throw new IllegalStateException("Wrong pass count");
            var buffer=((PostPassAccessor)passes.getFirst()).anor$getUniformBuffers().get("AnorLondo");
            if(buffer==null||buffer.size()!=32)throw new IllegalStateException("Wrong uniform buffer layout");
            RegionalPostEffect.uploadUniforms(effect,1);
            effect.render(client.getFramebuffer(),pool);
            RegionalPostEffect.uploadUniforms(effect,0.5);effect.render(client.getFramebuffer(),pool);
            RegionalPostEffect.uploadUniforms(effect,0);effect.render(client.getFramebuffer(),pool);
            if(AnorLondoAtmosphere.matchesWorld(client)||AnorLondoAtmosphere.weight()!=0)throw new IllegalStateException("Title screen should not be covered");
            result="PASS: Fabric client initialized; required mixins applied; shader pipeline and GPU uniforms created; both passes rendered; title screen outside region.\n";
            AnorLondoAtmosphere.LOG.info(result.trim());
        }catch(Throwable error){result="FAIL: "+error+"\n";AnorLondoAtmosphere.LOG.error("Runtime checks failed",error);}
        try{String destination=System.getProperty("anorlondo.selftestOutput");if(destination!=null)Files.writeString(Path.of(destination),result);}catch(Exception error){AnorLondoAtmosphere.LOG.error("Cannot write check report",error);}
        client.scheduleStop();
    }
}
