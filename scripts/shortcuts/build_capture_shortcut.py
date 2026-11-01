"""Build an inspectable, credential-free Apple Shortcut; sign with Apple's CLI.

Usage: python3 scripts/shortcuts/build_capture_shortcut.py
Then: shortcuts sign --mode anyone --input /tmp/send-to-shiguang.unsigned.shortcut
      --output client/public/shortcuts/send-to-shiguang.shortcut
"""
import plistlib
import uuid
from pathlib import Path


def text(value, reference=None, prefix=""):
    data = {"string": value}
    if reference:
        data = {"string": prefix + "\ufffc", "attachmentsByRange": {
            "{%d, 1}" % len(prefix): reference,
        }}
    return {"Value": data, "WFSerializationType": "WFTextTokenString"}


def attachment(reference):
    return {"Value": reference, "WFSerializationType": "WFTextTokenAttachment"}


actions = []


def action(identifier, **params):
    action_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"shiguang-capture-v1:{len(actions)}" )).upper()
    actions.append({"WFWorkflowActionIdentifier": "is.workflow.actions." + identifier,
                    "WFWorkflowActionParameters": {**params, "UUID": action_id}})
    return {"Type": "ActionOutput", "OutputUUID": action_id, "OutputName": identifier}


def dictionary(items):
    return {"Value": {"WFDictionaryFieldValueItems": [
        {"WFItemType": 0, "WFKey": text(key), "WFValue": value} for key, value in items.items()
    ]}, "WFSerializationType": "WFDictionaryFieldValue"}


binding = action("gettext", WFTextActionText='{"url":"https://www.drinkingtime.top/api/material-captures/receive","token":"请粘贴在拾光中生成的绑定信息，替换此整段文字"}')
config = action("detect.dictionary", WFInput=attachment(binding))
endpoint = action("getvalueforkey", WFInput=attachment(config), WFDictionary=attachment(config), WFDictionaryKey="url")
token = action("getvalueforkey", WFInput=attachment(config), WFDictionary=attachment(config), WFDictionaryKey="token")
group = str(uuid.uuid5(uuid.NAMESPACE_URL, "shiguang-capture-repeat-v1")).upper()
action("repeat.each", WFInput=attachment({"Type": "ExtensionInput"}), WFControlFlowMode=0, GroupingIdentifier=group)
action("base64encode", WFInput=attachment({"Type": "Variable", "VariableName": "Repeat Item"}), WFEncodeMode="Encode", WFBase64LineBreakMode="None")
repeated = action("repeat.each", WFControlFlowMode=2, GroupingIdentifier=group)
combined = action("text.combine", WFInput=attachment(repeated), WFTextSeparator="New Lines")
response = action("downloadurl", WFURL=text("", endpoint), WFHTTPMethod="POST", WFHTTPBodyType="JSON", Advanced=True, ShowHeaders=True,
                  WFHTTPHeaders=dictionary({"Content-Type": text("application/json"), "Authorization": text("", token, "Bearer ")}),
                  WFJSONValues=dictionary({"encodedItems": text("", combined)}))
message = action("getvalueforkey", WFInput=attachment(response), WFDictionary=attachment(response), WFDictionaryKey="message")
action("showresult", Text=text("", message))
workflow = {
    "WFWorkflowName": "发送到拾光",
    "WFWorkflowClientVersion": "3036.0.4.2",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 2846468607, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowTypes": ["ActionExtension"],
    "WFWorkflowInputContentItemClasses": ["WFStringContentItem", "WFRichTextContentItem", "WFURLContentItem", "WFImageContentItem", "WFGenericFileContentItem", "WFAVAssetContentItem"],
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowImportQuestions": [{"ActionIndex": 0, "Category": "Parameter", "ParameterKey": "WFTextActionText", "Text": "请粘贴拾光聊天 → 添加素材 → 从其他 App 发送中生成的整段绑定信息。仅用来向你的账号添加素材，不读取旧故事。", "DefaultValue": ""}],
    "WFWorkflowActions": actions,
}
output = Path("/tmp/send-to-shiguang.unsigned.shortcut")
output.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_XML, sort_keys=False))
print(output)
