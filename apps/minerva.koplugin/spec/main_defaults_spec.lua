local helper = require("spec_helper")
local stubs = require("spec.koreader_stubs")
local MinervaSync = require("main")

describe("Nearby BookDrop default", function()
    local saved, attached, read_setting
    before_each(function()
        helper.reset()
        stubs.reset()
        saved = package.loaded["minerva_localsend"]
        attached = nil
        read_setting = G_reader_settings.readSetting
        G_reader_settings.readSetting = function(self, key, default)
            local value = read_setting(self, key)
            if value == nil then return default end
            return value
        end
        package.loaded["minerva_localsend"] = {
            init = function(_, plugin) attached = plugin.settings.localsend_enabled end,
        }
    end)
    after_each(function()
        package.loaded["minerva_localsend"] = saved
        G_reader_settings.readSetting = read_setting
    end)

    local function init(settings)
        if settings then G_reader_settings:saveSetting("minerva_sync", settings) end
        local plugin = setmetatable({
            path = ".",
            ui = { menu = { registerToMainMenu = function() end } },
            registerFileDialogButton = function() end,
        }, { __index = MinervaSync })
        plugin:init()
    end

    it("enables receiving for a new installation", function()
        init()
        assert.is_true(attached)
    end)

    it("enables receiving when existing settings lack the preference", function()
        init({ auto_sync = false })
        assert.is_true(attached)
    end)

    it("preserves an explicit disabled preference", function()
        init({ localsend_enabled = false })
        assert.is_false(attached)
    end)
end)

describe("Minerva Cloud URL", function()
    local saved, read_setting
    before_each(function()
        helper.reset()
        stubs.reset()
        saved = package.loaded["minerva_localsend"]
        package.loaded["minerva_localsend"] = { init = function() end }
        read_setting = G_reader_settings.readSetting
        G_reader_settings.readSetting = function(self, key, default)
            local value = read_setting(self, key)
            if value == nil then return default end
            return value
        end
    end)
    after_each(function()
        package.loaded["minerva_localsend"] = saved
        G_reader_settings.readSetting = read_setting
    end)

    local function init(settings)
        if settings then G_reader_settings:saveSetting("minerva_sync", settings) end
        local plugin = setmetatable({
            path = ".",
            ui = { menu = { registerToMainMenu = function() end } },
            registerFileDialogButton = function() end,
        }, { __index = MinervaSync })
        plugin:init()
        return plugin.settings.supabase_url
    end

    -- The hosted account layer is not part of this fork: nothing is
    -- hardcoded, so a new installation has no URL and the plugin talks to a
    -- self-hosted Minerva Sync Worker instead.
    it("leaves the account layer unconfigured for a new installation", function()
        assert.are.equal("", init())
    end)

    it("drops the former vanity host", function()
        assert.are.equal("", init({ supabase_url = "https://readest.supabase.co" }))
    end)

    it("preserves a self-hosted URL", function()
        assert.are.equal("https://supabase.example.com",
            init({ supabase_url = "https://supabase.example.com" }))
    end)
end)
