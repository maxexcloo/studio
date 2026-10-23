# syntax=docker/dockerfile:1
FROM docker.io/stilldeadcode/radiance:1.10.0 AS radiance
FROM docker.io/yanwk/comfyui-boot:rocm-20261019

ENV PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_USER=false
COPY --from=radiance /opt/radiance /opt/radiance
COPY --from=radiance /lib64/ld-linux-x86-64.so.2 /opt/radiance/runtime/ld-linux-x86-64.so.2
COPY --from=radiance /usr/lib/x86_64-linux-gnu /opt/radiance/runtime/lib
RUN zypper --non-interactive install util-linux \
    && zypper clean --all \
    && python3 -m pip install --no-cache-dir fsspec==2026.9.0 peft==0.21.2 rotary_embedding_torch==0.9.1 \
    && rm -rf /root/ComfyUI
COPY worker/install_nodes.py worker/source.json worker/sources.json /opt/studio/
RUN python3 /opt/studio/install_nodes.py /opt/studio/source.json /opt/studio/sources.json /root/ComfyUI
COPY comfyui/ /root/ComfyUI/custom_nodes/
COPY worker/patches/ /opt/studio/patches/
COPY worker/entrypoint.sh worker/gpu-lease.sh /opt/studio/
RUN python3 /opt/studio/patches/patch_minimax.py /root/ComfyUI \
    && python3 -m compileall -q /root/ComfyUI/custom_nodes/radiance /root/ComfyUI/custom_nodes/studio_worker
WORKDIR /root/ComfyUI
EXPOSE 8000 8188
ENTRYPOINT ["/bin/sh", "/opt/studio/gpu-lease.sh", "/bin/bash", "/opt/studio/entrypoint.sh"]
CMD ["media"]
