package local.anorlondo.mixin;
import net.minecraft.client.render.GameRenderer;
import net.minecraft.client.render.RenderTickCounter;
import local.anorlondo.RegionalPostEffect;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(GameRenderer.class)
public class RendererMixin {
    @Inject(method="method_3188",at=@At("TAIL"),remap=false)
    private void anor$render(RenderTickCounter counter,CallbackInfo ci){RegionalPostEffect.render();}
}
