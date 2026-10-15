package local.anorlondo;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.buffers.GpuBuffer;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.PostEffectProcessor;
import net.minecraft.client.util.memory.ObjectPool;
import net.minecraft.util.Identifier;
import local.anorlondo.mixin.PostProcessorAccessor;
import local.anorlondo.mixin.PostPassAccessor;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Set;

public final class RegionalPostEffect {
    private static final Identifier EFFECT=Identifier.of("anorlondo","golden");
    private static final ObjectPool POOL=new ObjectPool(2);
    private static final ByteBuffer UNIFORM=ByteBuffer.allocateDirect(32).order(ByteOrder.nativeOrder());
    private static boolean failed=false;
    public static void reset(){failed=false;POOL.clear();}
    public static void uploadUniforms(PostEffectProcessor effect,double weight){
        var c=AnorLondoAtmosphere.config;
        UNIFORM.clear();UNIFORM.putFloat((float)weight).putFloat(c.exposure).putFloat(c.saturation).putFloat(c.contrast).putFloat(c.bloom).putFloat(0).putFloat(0).putFloat(0).flip();
        for(var pass:((PostProcessorAccessor)effect).anor$getPasses()){
            var buffers=((PostPassAccessor)pass).anor$getUniformBuffers();
            var buffer=buffers.get("AnorLondo");if(buffer==null)continue;
            if((buffer.usage()&GpuBuffer.USAGE_COPY_DST)==0){
                var writable=RenderSystem.getDevice().createBuffer(()->"Anor Londo regional parameters",GpuBuffer.USAGE_UNIFORM|GpuBuffer.USAGE_COPY_DST,32);
                buffers.put("AnorLondo",writable);buffer.close();buffer=writable;
            }
            RenderSystem.getDevice().createCommandEncoder().writeToBuffer(buffer.slice(),UNIFORM.duplicate());
        }
    }
    public static void render(){
        if(failed||!AnorLondoAtmosphere.config.postProcessing)return;
        double w=AnorLondoAtmosphere.weight();if(w<=0)return;
        MinecraftClient client=MinecraftClient.getInstance();
        // Preserve submersion and status-effect visibility rather than bleaching the screen.
        if(client.player==null||client.player.isSubmergedInWater()||client.player.isInLava()||client.player.hasStatusEffect(net.minecraft.entity.effect.StatusEffects.BLINDNESS)||client.player.hasStatusEffect(net.minecraft.entity.effect.StatusEffects.DARKNESS))return;
        try{
            PostEffectProcessor effect=client.getShaderLoader().loadPostEffect(EFFECT,Set.of(PostEffectProcessor.MAIN));
            if(effect==null){failed=true;AnorLondoAtmosphere.LOG.error("Regional post effect unavailable; sky/fog continue safely");return;}
            uploadUniforms(effect,w);
            effect.render(client.getFramebuffer(),POOL);POOL.decrementLifespan();
        }catch(Exception error){failed=true;AnorLondoAtmosphere.LOG.error("Regional post effect disabled after renderer error",error);}
    }
}
