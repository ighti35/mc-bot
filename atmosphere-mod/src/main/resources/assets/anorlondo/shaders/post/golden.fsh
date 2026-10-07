#version 330
uniform sampler2D InSampler;
layout(std140) uniform AnorLondo {
    float Strength; float Exposure; float Saturation; float Contrast;
    float Bloom; float Padding0; float Padding1; float Padding2;
};
in vec2 texCoord;
out vec4 fragColor;
float luminance(vec3 c){return dot(c,vec3(0.2126,0.7152,0.0722));}
vec3 highlight(vec2 uv){vec3 c=texture(InSampler,uv).rgb;return c*smoothstep(0.72,1.0,luminance(c));}
void main(){
    vec4 source=texture(InSampler,texCoord);
    vec2 pixel=1.0/vec2(textureSize(InSampler,0));
    vec3 glow=highlight(texCoord)*0.2;
    glow+=highlight(texCoord+pixel*vec2(3,0))*0.1+highlight(texCoord-pixel*vec2(3,0))*0.1;
    glow+=highlight(texCoord+pixel*vec2(0,3))*0.1+highlight(texCoord-pixel*vec2(0,3))*0.1;
    glow+=highlight(texCoord+pixel*vec2(7,7))*0.1+highlight(texCoord-pixel*vec2(7,7))*0.1;
    glow+=highlight(texCoord+pixel*vec2(-7,7))*0.1+highlight(texCoord-pixel*vec2(-7,7))*0.1;
    vec3 c=source.rgb;float l=luminance(c);
    c=mix(vec3(l),c,Saturation);
    c*=mix(vec3(0.91,0.96,1.035),vec3(1.065,1.012,0.93),smoothstep(0.10,0.78,l));
    c=(c-0.5)*Contrast+0.5;c*=Exposure;
    c+=glow*Bloom*vec3(1.06,1.00,0.90);
    float vignette=smoothstep(0.28,0.82,length(texCoord-0.5));c*=1.0-0.06*vignette;
    fragColor=vec4(mix(source.rgb,clamp(c,0.0,1.0),Strength),source.a);
}
