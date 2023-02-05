import * as React from 'react';
import {Box, Toolbar, TableContainer, Table, TableHead, TableRow, TableCell, Paper, TableBody, 
    tableCellClasses, Button, Modal, Typography, Select, MenuItem, FormControl, InputLabel, TextField,
    FormGroup, FormControlLabel, Checkbox, CircularProgress, Alert, Radio, RadioGroup, IconButton, Grid } from '@mui/material';
import {Delete, Close} from '@mui/icons-material';
import { styled } from '@mui/material/styles';
import { socket } from '../../../websocket/socket';
import * as Colors from '@mui/material/colors';
import {convertUpper, dynamicSort, dynamicSortDesc} from '../../functions'

const StyledTableCell = styled(TableCell)(({ theme }) => ({
    [`&.${tableCellClasses.head}`]: {
      backgroundColor: '#651fff',
      color: theme.palette.common.white,
    },
    [`&.${tableCellClasses.body}`]: {
      fontSize: 14,
    },
  }));
  
const StyledTableRow = styled(TableRow)(({ theme }) => ({
'&:nth-of-type(odd)': {
    backgroundColor: theme.palette.action.hover,
},
// hide last border
'&:last-child td, &:last-child th': {
    border: 0,
},
}));

const modalStyle = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '80vw',
    bgcolor: 'background.paper',
    border: '2px solid #000',
    boxShadow: 24,
    p: 4,
};

export default class SquadBotDefaultSquads extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            default_squads: [],

            alert: ''
        }
    }

    componentDidMount() {
        this.fetchGlobalVariable()
        socket.addEventListener('globalVariableUpdated', this.fetchGlobalVariable)
    }

    componentWillUnmount() {
        socket.removeEventListener('globalVariableUpdated', this.fetchGlobalVariable)
    }

    componentDidUpdate() {
        console.log('component update',this.state.default_squads)
    }

    fetchGlobalVariable = () => {
        socket.emit('globalVariables/fetch', {var_name: 'squadbot.default_squads'}, (res) => {
            console.log(res)
            if (res.code == 200) {
                this.setState({
                    default_squads: res.data.var_value
                })
            }
        })
    }

    addNewDefaultSquad = () => {
        return this.setState({
            default_squads: [...this.state.default_squads, {id: this.state.default_squads.length + 1, squad_string: 'new_squad', spots:4, members:[], is_default:true}]
        })
    }

    updateDefaultSquad = (arr_index, var_name, var_value) => {
        return this.setState(state => {
            const default_squads = state.default_squads.map((squad, index) => {
              if (index == arr_index) return {...squad, [var_name]: var_value}
              else return squad
            }).sort(dynamicSort("id"));
            return {
                default_squads,
            }
        });
    }

    deleteDefaultSquad = (arr_index) => {
        return this.setState({
            default_squads: this.state.default_squads.filter((squad,index) => index != arr_index)
        })
    }

    parseDefaultSquads = () => {
        const default_squads = this.state.default_squads
        var invalid_flag = false
        var invalid_reason = ''
        default_squads.forEach((squad, index )=> {
            if (squad.id == undefined || squad.squad_string == undefined || squad.spots == undefined || squad.is_default == undefined || squad.members == undefined) {
                invalid_flag = true
                invalid_reason = 'missing a required attribute'
                return
            } else {
                default_squads[index].squad_string = squad.squad_string.toLowerCase().trim().replace(/ /g,'_')
                if (default_squads[index].squad_string == 'new_squad') {
                    invalid_flag = true
                    invalid_reason = 'please enter new squad name'
                }
                if (default_squads[index].squad_string.length > 70) {
                    invalid_flag = true
                    invalid_reason = 'squad name cannot be longer than 70 characters'
                }
                if (default_squads[index].spots < 2 || default_squads[index].spots > 4) {
                    invalid_flag = true
                    invalid_reason = 'total spots should be between 2 - 4'
                }
            }
        })
        if (invalid_flag) return {
            err: true,
            message: invalid_reason
        }
        else return {
            data: default_squads
        }
    }

    saveChanges = () => {
        const parsed = this.parseDefaultSquads()
        if (parsed.err) return this.updateAlert(parsed.message)
        socket.emit('globalVariables/update', {var_name: 'squadbot.default_squads', var_value: parsed.data}, res => {
            this.updateAlert(res.message)
        })
    }

    updateAlert = (message) => {
        this.setState({
            alert: message
        }, () => setTimeout(() => {
            this.setState({alert: ''})
        }, 3000))
    }

    render() {
        return (
        <Box
            component="main"
            sx={{ flexGrow: 1, bgcolor: 'background.default', p: 3 }}
        >
            <Toolbar />
            <Grid item xs={12} >
                {this.state.alert != '' ? <Alert severity="info" sx={{m: '10px'}}>{this.state.alert}</Alert>:<></>}
            </Grid>
            {this.state.default_squads.length == 0 ? <div style={{display: 'flex', justifyContent: 'center'}}><CircularProgress /></div>:
            <Grid container style={{maxHeight: '80vh', overflow: 'auto'}}>
                {
                    this.state.default_squads.map((squad, index) => {
                        return (
                            <Grid container style={{ border: '5px solid #651fff', borderRadius: '20px', padding: '20px'}} sm={12} md={6} lg={3}>
                                <Grid item xs={10}>
                                    <TextField label="" size="small" variant="outlined" value={convertUpper(squad.squad_string)} onChange={(e) => this.updateDefaultSquad(index, 'squad_string',e.target.value)}/>
                                </Grid>
                                <Grid item xs={2}>
                                    <Button size='large' onClick={() => this.deleteDefaultSquad(index)}><Delete fontSize='small' sx={{ color: Colors.red[900] }} /></Button>
                                </Grid>
                                <Grid item xs={12}>{"\u200b"}</Grid>
                                <Grid item xs={4} style={{display: 'flex',alignItems: 'center', justifyContent: 'left'}}>
                                    <Typography>Total Spots: </Typography>
                                </Grid>
                                <Grid item xs={2}>
                                    <TextField label="" size="small" type="number"  InputProps={{ inputProps: { min: 2, max: 4 } }} variant="outlined" value={squad.spots} onChange={(e) => this.updateDefaultSquad(index, 'spots',e.target.value)}/>
                                </Grid>
                                <Grid item xs={6}></Grid>
                                <Grid item xs={4} style={{display: 'flex',alignItems: 'center', justifyContent: 'left'}}>
                                    <Typography>Order: </Typography>
                                </Grid>
                                <Grid item xs={3}>
                                    <TextField label="" size="small" type="number"  variant="outlined" value={squad.id} onChange={(e) => this.updateDefaultSquad(index, 'id', e.target.value)}/>
                                </Grid>
                            </Grid>
                        )
                    })
                }
            </Grid>
            }
            <Button variant="contained" style={{marginTop: '10px'}} onClick={() => this.addNewDefaultSquad()}>+ Add New</Button>

            <Button variant="contained" style={{marginTop: '10px', marginLeft: '10px'}} onClick={() => this.saveChanges()}>Save Changes</Button>

            <Button variant="contained" style={{marginTop: '10px', marginLeft: '10px'}} onClick={() => this.fetchGlobalVariable()}>Reset Changes</Button>
        </Box>
        );
    }
}