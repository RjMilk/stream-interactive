-- Stream Interactive: мост для Cyber Engine Tweaks.
-- Читает commands.txt в папке мода (его пишет программа Stream Interactive)
-- и выполняет команды в игре. Строка: id|команда|аргумент|ник|;

local POLL = 0.4          -- как часто читать файл, сек
local lastId = -1
local primed = false      -- при первом чтении старые команды пропускаются
local timer = 0

local function player() return Game.GetPlayer() end

local commands = {
    message = function(arg)
        player():SetWarningMessage(arg)
    end,

    status = function(arg)
        local p = player()
        Game.GetStatusEffectSystem():ApplyStatusEffect(p:GetEntityID(), TweakDBID.new(arg), p:GetRecordID(), p:GetEntityID())
    end,

    unstatus = function(arg)
        Game.GetStatusEffectSystem():RemoveStatusEffect(player():GetEntityID(), TweakDBID.new(arg))
    end,

    money = function(arg)
        Game.AddToInventory("Items.money", tonumber(arg) or 1000)
    end,

    steal = function(arg)
        Game.GetTransactionSystem():RemoveItemByTDBID(player(), TweakDBID.new("Items.money"), tonumber(arg) or 1000)
    end,

    heal = function()
        Game.GetStatPoolsSystem():RequestSettingStatPoolValue(player():GetEntityID(), gamedataStatPoolType.Health, 100, nil)
    end,

    skyfall = function(arg)
        local p = player()
        local pos = p:GetWorldPosition()
        local rot = p:GetWorldOrientation():ToEulerAngles()
        Game.GetTeleportationFacility():Teleport(p, Vector4.new(pos.x, pos.y, pos.z + (tonumber(arg) or 150), 1), rot)
    end,

    -- arg = множитель времени (0.3 = замедление), 0 = вернуть как было
    slowmo = function(arg)
        local k = tonumber(arg) or 0
        local name = CName.new("stream_interactive")
        if k > 0 then
            Game.GetTimeSystem():SetTimeDilation(name, k)
        else
            Game.GetTimeSystem():UnsetTimeDilation(name)
        end
    end,

    time = function(arg)
        Game.GetTimeSystem():SetGameTimeByHMS(tonumber(arg) or 0, 0, 0)
    end,

    weather = function(arg)
        Game.GetWeatherSystem():SetWeather(arg, 5.0, 9)
    end,
}

local function run(cmd, arg, user)
    local fn = commands[cmd]
    if not fn then
        print("[StreamInteractive] неизвестная команда: " .. tostring(cmd))
        return
    end
    local ok, err = pcall(fn, arg, user)
    if ok then
        print(string.format("[StreamInteractive] %s %s (%s)", cmd, arg, user))
    else
        print(string.format("[StreamInteractive] ошибка в %s: %s", cmd, tostring(err)))
    end
end

local function poll()
    local f = io.open("commands.txt", "r")
    if not f then primed = true return end
    local maxId = lastId
    for line in f:lines() do
        local id, cmd, arg, user = line:match("^(%d+)|([^|]*)|([^|]*)|([^|]*)|;")
        id = tonumber(id)
        if id and id > lastId then
            if id > maxId then maxId = id end
            if primed and player() then run(cmd, arg, user) end
        end
    end
    f:close()
    lastId = maxId
    primed = true
end

registerForEvent("onInit", function()
    print("[StreamInteractive] мост загружен")
end)

registerForEvent("onUpdate", function(dt)
    timer = timer + dt
    if timer < POLL then return end
    timer = 0
    pcall(poll)
end)
