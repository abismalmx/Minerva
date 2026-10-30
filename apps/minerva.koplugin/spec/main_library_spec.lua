-- main_library_spec.lua
-- MinervaSync:openLibrary hands KOReader's UI to the Library widget. Since
-- KOReader #16148, CoverBrowser's list and mosaic items format authors through
-- `menu.ui.bookinfo`, so a Library menu without `ui` crashed on the nightly
-- (issue #6823).

require("spec_helper")
local stubs = require("spec.koreader_stubs")

local MinervaSync = require("main")

describe("MinervaSync:openLibrary", function()
    local real_open

    before_each(function()
        stubs.reset()
        real_open = stubs.LibraryWidget.open
    end)

    after_each(function()
        stubs.LibraryWidget.open = real_open
    end)

    it("passes the plugin's UI to the Library widget", function()
        local ui = { bookinfo = {} }
        local plugin = setmetatable({
            settings = { access_token = "tok", user_id = "user" },
            path = "/plugins/minerva.koplugin",
            ui = ui,
        }, { __index = MinervaSync })
        local opened
        stubs.LibraryWidget.open = function(opts) opened = opts end

        plugin:openLibrary()

        assert.is_table(opened)
        assert.are.equal(ui, opened.ui)
    end)
end)
