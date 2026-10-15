package local.anorlondo.mixin;
import net.minecraft.world.World;
import local.anorlondo.AnorLondoAtmosphere;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
@Mixin(World.class)
public class WeatherMixin {
    @Inject(method={"method_8430","method_8478"},at=@At("RETURN"),cancellable=true,remap=false)
    private void anor$weather(float tickDelta,CallbackInfoReturnable<Float> cir){double w=AnorLondoAtmosphere.weatherWeight((World)(Object)this);if(w>0)cir.setReturnValue((float)(cir.getReturnValue()*(1-w)));}
}
