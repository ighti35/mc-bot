package local.anorlondo.mixin;
import net.minecraft.client.gl.PostEffectProcessor;
import net.minecraft.client.gl.PostEffectPass;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import java.util.List;
@Mixin(PostEffectProcessor.class)
public interface PostProcessorAccessor {@Accessor(value="field_1497",remap=false) List<PostEffectPass> anor$getPasses();}
