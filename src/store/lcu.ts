import { defineStore } from "pinia";
import { Ref, ref } from "vue";
import lcuApi from "@/api/lcuApi";
import { SummonerInfo, TeamMember, TeamMemberInfo } from "@@/types/lcuType";
import useSettingStore from "@/store/setting";
import { GameMode, PositionName, Rune } from "@@/types/opgg_rank_type";
import { analysisTeam, analysisTeamUpInfo, generateAnalysisMsg } from "@/utils/gameAnalysis";
import { CustomRune } from "@@/types/type";
import { champDict } from "@@/const/lolDataConfig";
import { convertOPGGRuneFormat } from "@@/lcu/opgg";
import useAppStore from "@/store/app";
import router from "@/router";
import { Handle } from "@@/const/const";

export enum ConnectStatusEnum {
	connecting,
	connected,
	disconnect
}

export type GameFlowPhase =
	| "Lobby"
	| "Matchmaking"
	| "ReadyCheck"
	| "ChampSelect"
	| "GameStart"
	| "InProgress"
	| "WaitingForStats"
	| "PreEndOfGame"
	| "EndOfGame"
	| "None";

export const gameFlowPhaseMap: Record<GameFlowPhase, string> = {
	Lobby: "大厅",
	Matchmaking: "匹配中",
	ReadyCheck: "确认匹配",
	ChampSelect: "英雄选择",
	GameStart: "游戏开始",
	InProgress: "对局中",
	WaitingForStats: "等待统计",
	PreEndOfGame: "游戏结束前",
	EndOfGame: "游戏结束",
	None: "None"
};

const useLCUStore = defineStore("lcu", () => {
	const connectStatus = ref(ConnectStatusEnum.disconnect) as Ref<ConnectStatusEnum>;
	const summonerInfo = ref<SummonerInfo>();
	const search = ref("");

	const gameFlowPhase = ref<GameFlowPhase>("None");
	const champId = ref(0);
	const currentGameMode = ref<GameMode>();
	const currentPosition = ref<PositionName>();
	const currentChatRoomId = ref<string>();
	const myTeam = ref<TeamMemberInfo[]>([]);
	const theirTeam = ref<TeamMemberInfo[]>([]);

	//我方队伍组队信息
	const myTeamUpInfo = ref<Array<Array<string>>>([]);
	//对方队伍主队信息
	const theirTeamUpInfo = ref<Array<Array<string>>>([]);
	//对方为胜率队
	const theirTeamIsSuck = ref(false);

	const queryMyTeamFlag = ref(false);
	const queryTheirTeamFlag = ref(false);

	const settingStore = useSettingStore();

	function sendTeamScoreToRoom() {
		const msg = generateAnalysisMsg(myTeam.value);
		if (gameFlowPhase.value !== "ChampSelect") {
			message.warning("只能在选英雄阶段发送");
			return;
		}
		console.log("队伍分析", msg);
		void lcuApi.sendChatMsgToRoom(currentChatRoomId.value!, msg, "groupchat");
	}

	async function analysisMyTeam() {
		queryMyTeamFlag.value = true;
		myTeam.value = await analysisTeam(myTeam.value).finally(() => (queryMyTeamFlag.value = false));
		if (settingStore.settingModel.autoSendMyTeamAnalysis) {
			sendTeamScoreToRoom();
		}
		myTeamUpInfo.value = await analysisTeamUpInfo(myTeam.value);
	}

	async function analysisTheirTeam() {
		queryTheirTeamFlag.value = true;
		theirTeam.value = await analysisTeam(theirTeam.value).finally(() => (queryTheirTeamFlag.value = false));
		const msg = generateAnalysisMsg(theirTeam.value);
		console.log("对方队伍分析", msg);
	}

	function updateChampId(id: number) {
		champId.value = id;
	}

	async function getCurrentSummoner() {
		if (!summonerInfo.value?.puuid) {
			summonerInfo.value = await lcuApi.getCurrentSummoner();
		}
		return summonerInfo.value;
	}

	function refreshConnectStatus() {
		lcuApi.queryConnectStatus().then((connected: boolean = false) => {
			connectStatus.value = connected ? ConnectStatusEnum.connected : ConnectStatusEnum.disconnect;
		});
	}

	//更新队伍信息
	async function updateTeamsInfo(teams: TeamMember[][]) {
		const currentSummoner = await getCurrentSummoner();
		const myTeamMemberIndex = teams.findIndex((arr) => arr.find((t) => t.puuid === currentSummoner.puuid));
		updateMyTeamInfo(teams[myTeamMemberIndex]);
		await updateTheirTeamInfo(teams[myTeamMemberIndex === 0 ? 1 : 0]);
		await analysisTheirTeam();
		theirTeamIsSuck.value = false;
		theirTeamUpInfo.value = await analysisTeamUpInfo(theirTeam.value);
		//如果对面5黑，并且都是隐藏生涯，就判断是胜率队
		if (
			currentGameMode.value === "aram" &&
			theirTeamUpInfo.value?.[0].length === 5 &&
			theirTeam.value.filter((m) => m.summonerInfo.privacy === "PRIVATE")?.length === 5
		) {
			new window.Notification("胜率队检测", { body: "对方为胜率队" }).onclick = async () => {
				await window.ipcRenderer.invoke(Handle.showMainWindow);
				await router.push({ name: "inGame", params: { showAnalysis: "true" } });
			};
			theirTeamIsSuck.value = true;
		} else if (theirTeamUpInfo.value.length != 0) {
			let i = 1;
			// const msg = theirTeamUpInfo.value
			// 	.map(
			// 		(t) =>
			// 			`组队${i++}: ${t.map((puuid) => theirTeam.value.find((tm) => tm.puuid === puuid)?.summonerName).join("\t")}`
			// 	)
			// 	.join("\n");
			new window.Notification("对面存在开黑组队", { body: "跳转对局分析查看" }).onclick = async () => {
				await window.ipcRenderer.invoke(Handle.showMainWindow);
				await router.push({ name: "inGame", params: { showAnalysis: "true" } });
			};
		}
	}

	async function fetchTeamMembersGameDetail(teams: TeamMemberInfo[]) {
		return await Promise.all(
			teams.map(
				async (team) =>
					({
						...team,
						gameDetail: await lcuApi.queryTeamMemberGameDetail(team.puuid)
					}) as TeamMemberInfo
			)
		);
	}

	//刚进入房间时就只能得到召唤师信息，进入游戏前得到位置英雄等信息然后更新下
	function updateMyTeamInfo(teamMembers: TeamMember[]) {
		myTeam.value = teamMembers.map((t) => {
			const originInfo = myTeam.value.find((i) => i.puuid === t.puuid);
			return {
				...originInfo,
				assignedPosition: t.selectedPosition?.toLowerCase(),
				championId: t.championId
			} as TeamMemberInfo;
		});
	}

	async function updateTheirTeamInfo(teamMembers: TeamMember[]) {
		theirTeam.value = await Promise.all(
			teamMembers.map(async (t) => {
				const summonerInfo = await lcuApi.getSummonerByPuuid(t.puuid);
				return {
					assignedPosition: t.selectedPosition?.toLowerCase(),
					championId: t.championId,
					puuid: t.puuid,
					summonerName: t.summonerName,
					gameDetail: [],
					summonerInfo: summonerInfo
				} as TeamMemberInfo;
			})
		).catch((e) => {
			message.error(e.message);
			console.log("查询对方成员信息失败：", (e as Error)?.message);
			return [];
		});
	}

	const opggRunes = ref([]) as Ref<Rune[]>;
	const customRunes = ref([]) as Ref<CustomRune[]>;
	const loadingRune = ref(false);

	watch(
		champId,
		(n, o) => {
			if (n) {
				void fetchRune(n);
			}
		},
		{ immediate: true }
	);
	const message = useAppStore().message;
	const applyRune = (rune: Rune | CustomRune) => {
		let name: string;
		if ("name" in rune) {
			name = rune?.name;
		} else {
			name = "OP.GG " + champDict[champId.value + ""]?.label;
		}
		lcuApi.applyRune(convertOPGGRuneFormat(rune, name)).then(() => {
			message.success("符文已应用");
		});
	};

	const fetchRune = async (champId: number) => {
		loadingRune.value = true;
		const gameModeVal = unref(currentGameMode);
		const positionVal = unref(currentPosition);
		try {
			customRunes.value = await lcuApi
				.getCustomRunes(champId, gameModeVal, positionVal)
				.then((res) => res?.map((i) => i.value) || []);
			opggRunes.value = (await lcuApi.getOPGGRunes(champId, gameModeVal, positionVal)) || [];
			if (settingStore.settingModel.autoConfigRune) {
				if (settingStore.settingModel.autoConfigRuneOPGGPriority && opggRunes.value.length) {
					applyRune(opggRunes.value[0]);
				} else if (customRunes.value.length) {
					applyRune(customRunes.value[0]);
				}
			}
		} catch (e: any) {
			message.error(e.message);
		} finally {
			loadingRune.value = false;
		}
	};

	return {
		champId,
		updateChampId,
		updateTeamsInfo,
		currentChatRoomId,
		currentGameMode,
		currentPosition,
		myTeam,
		queryMyTeamFlag,
		theirTeam,
		queryTheirTeamFlag,
		myTeamUpInfo,
		theirTeamUpInfo,
		theirTeamIsSuck,
		gameFlowPhase,
		connectStatus,
		getCurrentSummoner,
		summonerInfo,
		refreshConnectStatus,
		search,
		analysisMyTeam,
		analysisTheirTeam,
		sendTeamScoreToRoom,
		loadingRune,
		applyRune,
		customRunes,
		opggRunes
	};
});

export default useLCUStore;
