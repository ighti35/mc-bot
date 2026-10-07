package local.botui;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.client.gui.screen.ingame.GenericContainerScreen;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.minecraft.client.MinecraftClient;
public class BotInventoryClient implements ClientModInitializer {
    @Override public void onInitializeClient() {
        ClientCommandRegistrationCallback.EVENT.register((dispatcher,registry)->dispatcher.register(ClientCommandManager.literal("botbuild").executes(context->{MinecraftClient.getInstance().execute(()->MinecraftClient.getInstance().setScreen(new BotBuildScreen()));return 1;})));
        ScreenEvents.AFTER_INIT.register((client, screen, width, height) -> {
            if (screen instanceof GenericContainerScreen container && screen.getTitle().getString().startsWith(BotInventoryMod.PREFIX))
                client.setScreen(new BotInventoryScreen(container.getScreenHandler(), client.player.getInventory(), screen.getTitle()));
        });
    }
}
