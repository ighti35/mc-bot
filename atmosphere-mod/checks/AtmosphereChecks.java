import local.anorlondo.AtmosphereConfig;
import java.nio.file.*;
import com.google.gson.JsonParser;
import com.mojang.serialization.JsonOps;
import net.minecraft.client.gl.PostEffectPipeline;
public class AtmosphereChecks {
    static int passed=0;
    static void check(boolean value,String label){if(!value)throw new AssertionError(label);passed++;System.out.println("PASS "+label);}
    public static void main(String[] args)throws Exception{
        AtmosphereConfig c=new AtmosphereConfig();c.validate();
        check(c.weight(-577,72)==1,"Anor Londo center fully covered");
        check(c.weight(-1254,109)==0,"Raya Lucaria entirely outside");
        check(c.weight(0,0)==0,"World spawn outside");
        check(c.weight(-899,72)==0&&c.weight(-264,72)==0&&c.weight(-577,-387)==0&&c.weight(-577,536)==0,"all four outside edges exactly untouched");
        check(c.weight(-898,72)==0&&c.weight(-866,72)==1&&c.weight(-882,72)==0.5,"fade stays inside bounds");
        double last=-1;for(int x=-898;x<=-866;x++){double w=c.weight(x,72);check(w>=last&&w<=1,"smooth transition "+x);last=w;}
        check(c.weight(Double.NaN,72)==0,"invalid camera location ignored");
        c.enabled=false;check(c.weight(-577,72)==0,"disabled restores vanilla");c.enabled=true;
        check(AtmosphereConfig.color(0x12345678,0xFFFFFFFF,0)==0x12345678,"outside color bit-exact");
        check(AtmosphereConfig.color(0x00000000,0xFFFFFFFF,0.5)==0x80808080,"ARGB interpolated including sunset alpha");
        check(AtmosphereConfig.angle(350,10,0.5)==360,"sun angle takes short path");
        check(AtmosphereConfig.blend(0.4f,1,0)==0.4f,"outside brightness unchanged");
        c.fadeBlocks=Double.NaN;boolean rejected=false;try{c.validate();}catch(IllegalArgumentException e){rejected=true;}check(rejected,"NaN config rejected");
        c=new AtmosphereConfig();c.fogStart=c.fogEnd;rejected=false;try{c.validate();}catch(IllegalArgumentException e){rejected=true;}check(rejected,"invalid fog ordering rejected");
        Path temp=Files.createTempDirectory("anor-config-check-");try{AtmosphereConfig generated=AtmosphereConfig.load(temp.resolve("region.json"));check(generated.minX==-898&&generated.saveFolder.equals("example_world"),"generated config bound to intended save");}finally{Files.deleteIfExists(temp.resolve("region.json"));Files.delete(temp);}
        var json=JsonParser.parseString(Files.readString(Path.of(args[0])));
        var pipeline=PostEffectPipeline.CODEC.parse(JsonOps.INSTANCE,json).getOrThrow();check(pipeline.passes().size()==2,"actual Minecraft post effect codec accepts both passes");
        check(pipeline.passes().get(0).uniforms().get("AnorLondo").size()==8,"GPU uniform layout includes eight floats");
        System.out.println("Checks passed: "+passed);
    }
}
