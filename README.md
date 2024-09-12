# SillyTavern Avatar Replacement

Add an endpoint to replace the avatar of a character.

Needed for [SillyTavern-AnotherCharManager](https://github.com/sakhavhyand/SillyTavern-AnotherCharManager) extension in order to use the avatar replacement feature.

## Installation

1. **Before you begin, make sure you set a config `enableServerPlugins` to `true` in the config.yaml file of SillyTavern.**

2. Open a terminal in your SillyTavern directory, then run the following:

```
cd plugins
git clone https://github.com/SillyTavern/SillyTavern-DiscordRichPresence-Server
```

3. Restart the SillyTavern server.

## Usage
```
/api/plugins/avataredit/edit-avatar
OR
/api/plugins/avataredit/edit-avatar?crop={cropdata}

FORMDATA
{
    'avatar': FILE,
    'avatar_url': 'default_FluxTheCat.png'
}
-> Code 200
```
