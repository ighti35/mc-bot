package local.anorlondo.mixin;
import net.minecraft.world.attribute.EnvironmentAttribute;
import net.minecraft.world.attribute.EnvironmentAttributeInterpolator;
import local.anorlondo.AnorLondoAtmosphere;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
@Mixin(EnvironmentAttributeInterpolator.class)
public class AttributeMixin {
    @Inject(method="method_75689",at=@At("RETURN"),cancellable=true,remap=false)
    private <T> void anor$attribute(EnvironmentAttribute<T> attribute,float tickDelta,CallbackInfoReturnable<T> cir){
        @SuppressWarnings("unchecked") T value=(T)AnorLondoAtmosphere.attribute(attribute,cir.getReturnValue());cir.setReturnValue(value);
    }
}
