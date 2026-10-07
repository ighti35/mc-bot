package local.anorlondo.mixin;
import net.minecraft.client.sound.MusicTracker;
import local.anorlondo.AnorLondoAtmosphere;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(MusicTracker.class)
public class MusicMixin {
    @Inject(method="method_18669",at=@At("HEAD"),cancellable=true,remap=false)
    private void anor$music(CallbackInfo ci){if(AnorLondoAtmosphere.MUSIC.suppressVanilla())ci.cancel();}
}
