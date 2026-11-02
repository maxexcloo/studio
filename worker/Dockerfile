# syntax=docker/dockerfile:1
FROM docker.io/stilldeadcode/radiance:1.15.1 AS radiance
FROM docker.io/yanwk/comfyui-boot:rocm-20261027

ENV PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_USER=false
COPY --from=radiance /opt/radiance /opt/radiance
COPY --from=radiance /lib64/ld-linux-x86-64.so.2 /opt/radiance/runtime/ld-linux-x86-64.so.2
COPY --from=radiance /usr/lib/x86_64-linux-gnu /opt/radiance/runtime/lib
RUN python3 -m pip install --no-cache-dir fsspec==2026.9.0 peft==0.21.2 rotary_embedding_torch==0.9.1 \
    && rm -rf /root/ComfyUI
COPY worker/install_nodes.py worker/source.json worker/sources.json /opt/studio/
RUN python3 /opt/studio/install_nodes.py /opt/studio/source.json /opt/studio/sources.json /root/ComfyUI
COPY worker/comfyui/ /root/ComfyUI/custom_nodes/
COPY worker/patches/ /opt/studio/patches/
COPY worker/entrypoint.sh /opt/studio/
RUN python3 /opt/studio/patches/patch_minimax.py /root/ComfyUI \
    && python3 -m compileall -q /root/ComfyUI/custom_nodes/radiance /root/ComfyUI/custom_nodes/studio_worker
# Update affected runtime packages through the official repositories; other image repositories are unrelated.
RUN sed -i 's|http://download.opensuse.org/|https://download.opensuse.org/|g' /etc/zypp/repos.d/*.repo \
    && zypper --non-interactive refresh repo-oss repo-update \
    && zypper --non-interactive --no-refresh update --repo repo-oss --repo repo-update --no-recommends \
        libpcre2-8-0 libpcre2-16-0 libpcre2-32-0 python313 python313-dbm \
    && zypper clean --all \
    && python3 -m pip install --no-cache-dir uv==0.13.6
COPY LICENSE /opt/studio/LICENSE
WORKDIR /root/ComfyUI
EXPOSE 8188
ENTRYPOINT ["/bin/bash", "/opt/studio/entrypoint.sh"]
