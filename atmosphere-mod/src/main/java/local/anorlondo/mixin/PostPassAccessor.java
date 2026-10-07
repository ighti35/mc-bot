package local.anorlondo.mixin;
import net.minecraft.client.gl.PostEffectPass;
import com.mojang.blaze3d.buffers.GpuBuffer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import java.util.Map;
@Mixin(PostEffectPass.class)
public interface PostPassAccessor {@Accessor(value="field_60123",remap=false) Map<String,GpuBuffer> anor$getUniformBuffers();}
