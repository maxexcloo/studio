# CLIProxyAPI Node

A ComfyUI custom node for Grok image and video generation through a configured
CLIProxyAPI. Outputs stay in the ComfyUI instance.

## Install

The Studio container image includes it at `/app/comfyui/cliproxy`, so a ComfyUI
image can copy it from the matching Studio release into `custom_nodes/cliproxy`.

## Configuration

The node discovers advertised Grok image and video models from `/v1/models`,
cached for one minute. Set `CLIPROXYAPI_URL` and `CLIPROXYAPI_KEY` in the
deployment. Optional `CLIPROXYAPI_IMAGE_MODEL` and `CLIPROXYAPI_VIDEO_MODEL`
select defaults; otherwise the first advertised model of each kind is selected
alphabetically. Defaults must be advertised by that provider.

Known request formats and limits remain explicit because discovery does not
publish their complete schemas. New advertised variants use the standard
endpoint format and provider resolution defaults; an explicit resolution is
passed through for the provider to validate. Refresh the node's model list after
provider changes. Discovery failure leaves an empty selector and generation
reports the provider error.

Cancelling a job stops local waiting and discards late responses. The provider
may still finish or bill a submitted job; cancellation never resubmits it. The
unused seed control is removed, while saved API workflows may still send it.
