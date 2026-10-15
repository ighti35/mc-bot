package local.anorlondo.mixin;
import net.minecraft.client.MinecraftClient;
import local.anorlondo.AnorLondoAtmosphere;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(MinecraftClient.class)
public class ClientTickMixin {
    @Inject(method="method_1574",at=@At("TAIL"),remap=false)
    private void anor$tick(CallbackInfo ci){AnorLondoAtmosphere.MUSIC.tick((MinecraftClient)(Object)this);local.anorlondo.RuntimeChecks.tick((MinecraftClient)(Object)this);local.anorlondo.WorldChecks.tick((MinecraftClient)(Object)this);}
}
