package local.anorlondo;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.nio.file.*;
import java.io.IOException;

public final class AtmosphereConfig {
    public boolean enabled=false;
    public String saveFolder="example_world";
    public String dimension="minecraft:overworld";
    public int minX=0,maxX=128,minZ=0,maxZ=128;
    public double fadeBlocks=32;
    public float sunAngle=78,skyLightFactor=0.83f,fogStart=128,fogEnd=360,cloudHeight=350;
    public int skyColor=0xFFAFA38F,fogColor=0xFFB8AA93,cloudColor=0xFFE3D3BA,skyLightColor=0xFFFFE0B9,sunsetColor=0x80EFAE66;
    public boolean clearWeather=true,postProcessing=true,music=true;
    public float exposure=1.02f,saturation=0.88f,contrast=1.065f,bloom=0.14f,musicVolume=0.55f;
    public static final Gson GSON=new GsonBuilder().setPrettyPrinting().create();
    public void validate(){
        if(saveFolder==null||saveFolder.isBlank()||saveFolder.contains("/")||saveFolder.contains("\\"))throw new IllegalArgumentException("saveFolder 必须是存档文件夹名称");
        if(!"minecraft:overworld".equals(dimension))throw new IllegalArgumentException("只允许绑定主世界");
        if(minX>=maxX||minZ>=maxZ||Math.abs((long)minX)>29999984||Math.abs((long)maxX)>29999984||Math.abs((long)minZ)>29999984||Math.abs((long)maxZ)>29999984)throw new IllegalArgumentException("区域范围无效");
        check(fadeBlocks,1,128,"fadeBlocks");check(sunAngle,0,360,"sunAngle");check(skyLightFactor,0,1,"skyLightFactor");check(fogStart,0,1024,"fogStart");check(fogEnd,16,2048,"fogEnd");
        if(fogStart>=fogEnd)throw new IllegalArgumentException("fogStart 必须小于 fogEnd");
        check(cloudHeight,64,512,"cloudHeight");check(exposure,0.5,1.5,"exposure");check(saturation,0,1.5,"saturation");check(contrast,0.7,1.3,"contrast");check(bloom,0,0.4,"bloom");check(musicVolume,0,1,"musicVolume");
    }
    private static void check(double v,double min,double max,String label){if(!Double.isFinite(v)||v<min||v>max)throw new IllegalArgumentException(label+" 数值无效");}
    public static AtmosphereConfig load(Path file)throws IOException{
        AtmosphereConfig value;
        if(Files.exists(file)){try(var reader=Files.newBufferedReader(file)){value=GSON.fromJson(reader,AtmosphereConfig.class);}if(value==null)throw new IOException("配置文件为空");}
        else{value=new AtmosphereConfig();Files.createDirectories(file.getParent());Files.writeString(file,GSON.toJson(value));}
        value.validate();return value;
    }
    public double weight(double x,double z){
        if(!enabled||!Double.isFinite(x)||!Double.isFinite(z)||x<minX||x>maxX+1.0||z<minZ||z>maxZ+1.0)return 0;
        double edge=Math.min(Math.min(x-minX,maxX+1.0-x),Math.min(z-minZ,maxZ+1.0-z));
        double t=Math.max(0,Math.min(1,edge/fadeBlocks));return t*t*(3-2*t);
    }
    public static float blend(float from,float to,double w){return (float)(from+(to-from)*w);}
    public static float angle(float from,float to,double w){float delta=(to-from+540)%360-180;return from+(float)(delta*w);}
    public static int color(int from,int to,double w){
        if(w<=0)return from;if(w>=1)return to;int result=0;
        for(int shift=0;shift<=24;shift+=8){int a=(from>>>shift)&255,b=(to>>>shift)&255;result|=(int)Math.round(a+(b-a)*w)<<shift;}return result;
    }
}
